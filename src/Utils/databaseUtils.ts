import {DatabaseConfig, DatabaseDriver} from "../Common/interfaces";
import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {MongoConnectionOptions} from "typeorm/driver/mongodb/MongoConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {resolve} from 'path';
import "reflect-metadata";
import {DataSource} from "typeorm";
import {getDatabaseLogger, getLogger} from "./loggerFactory";
import {fileOrDirectoryIsWriteable} from "../util";
import {Logger} from "winston";
import {CMNamingStrategy} from "./CMNamingStrategy";
import {ErrorWithCause} from "pony-cause";

export const isDatabaseDriver = (val: any): val is DatabaseDriver => {
    if (typeof val !== 'string') {
        return false;
    }
    return ['sqljs', 'mysql', 'mariadb', 'postgres', 'mongo'].some(x => x === val.toLocaleLowerCase());
}

export const createDatabaseConfig = (val: DatabaseDriver | any): DatabaseConfig => {
    // handle string value
    if (isDatabaseDriver(val)) {
        switch (val) {
            case 'sqljs':
                return {
                    type: 'sqljs',
                    autoSave: true,
                    location: resolve(`${__dirname}`, '../../database.sqlite')
                } as SqljsConnectionOptions;
            case 'mysql':
            case 'mariadb':
                return {
                    type: val,
                    host: 'localhost',
                    port: 3306
                } as MysqlConnectionOptions;
            case 'postgres':
                return {
                    type: 'postgres',
                    host: 'localhost',
                    port: 5432
                } as PostgresConnectionOptions;
        }
    }

    // handle sqljs db location and autoSave default
    const {
        type,
        location = resolve(`${__dirname}`, '../../database.sqlite'),
        ...rest
    } = val;
    if (type === 'sqljs') {
        return {
            type,
            location: location.trim() === ':memory:' ? undefined : resolve(location),
            autoSave: true, // default autoSave to true since this is most likely the expected behavior
            ...rest,
        } as SqljsConnectionOptions;
    }
    return val as DatabaseConfig;
}

export const createDatabaseConnection = async (rawConfig: DatabaseConfig, logger: Logger): Promise<DataSource> => {

    let config = {...rawConfig};

    if (rawConfig.type === 'sqljs') {

        // if we can't write to a real file location then autosave can't be used in config options
        // -- it tells typeorm to automatically write DB changes (after successfully commits/transactions) to file
        let locationData: Pick<SqljsConnectionOptions, 'autoSave' | 'location'> = {
            autoSave: false,
            location: undefined,
        };

        if(typeof rawConfig.location === 'string' && rawConfig.location !== ':memory:') {
            const location = rawConfig.location as string;
            try {
                await fileOrDirectoryIsWriteable(location);
                locationData = {
                    autoSave: true,
                    location,
                };
            } catch (e: any) {
                logger.error(new ErrorWithCause(`Falling back to IN-MEMORY database due to error while trying to access database file at ${location})`, {cause: e}));
            }
        }

        config = {...config, ...locationData};
    }

    const source = new DataSource({
        ...config,
        synchronize: false,
        entities: [`${resolve(__dirname, '../Common/Entities')}/**/*.js`],
        migrations: [`${resolve(__dirname, '../Common/Migrations')}/Database/*.js`],
        migrationsRun: false,
        logging: ['error','warn','migration'],
        logger: getDatabaseLogger(logger, ['error','warn','migration', 'schema']),
        namingStrategy: new CMNamingStrategy(),
    });
    await source.initialize();
    return source;
}
