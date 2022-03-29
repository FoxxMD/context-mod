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

const validDrivers = ['sqljs', 'mysql', 'mariadb', 'postgres'];

export const isDatabaseDriver = (val: any): val is DatabaseDriver => {
    if (typeof val !== 'string') {
        return false;
    }
    return validDrivers.some(x => x === val.toLocaleLowerCase());
}

export const asDatabaseDriver = (val: string): DatabaseDriver => {
    const cleanVal = val.trim().toLocaleLowerCase();
    if(isDatabaseDriver(cleanVal)) {
        return cleanVal;
    }
    throw new Error(`Value '${cleanVal}' is not a valid driver. Must be one of: ${validDrivers.join(', ')}`);
}

export const createDatabaseConfig = (val: DatabaseDriver | any): DatabaseConfig => {
    try {
        let dbType: DatabaseDriver;
        let userDbConfig: any = {};
        if (typeof val === 'string') {
            dbType = asDatabaseDriver(val);
        } else {
            if (val === undefined) {
                throw new Error(`databaseConfig.connection must be either a string or an object with 'type' of a valid database type: ${validDrivers.join(', ')}`);
            }

            // assuming they modified default connection params but forgot to include db type
            const {
                type = 'sqljs',
                ...rest
            } = val;

            dbType = asDatabaseDriver(val.type);

            userDbConfig = rest;
        }

        switch (dbType) {
            case 'sqljs':
                const {
                    location = resolve(`${__dirname}`, '../../database.sqlite'),
                    ...rest
                } = userDbConfig;

                return {
                    type: dbType,
                    autoSave: true, // default autoSave to true since this is most likely the expected behavior
                    location: typeof location === 'string' && location.trim().toLocaleLowerCase() !== ':memory:' ? resolve(location) : location,
                    ...rest
                } as SqljsConnectionOptions;

            case 'mysql':
            case 'mariadb':
                return {
                    type: dbType,
                    host: 'localhost',
                    port: 3306,
                    timezone: 'z',
                    ...userDbConfig,
                } as MysqlConnectionOptions;
            case 'postgres':
                return {
                    type: dbType,
                    host: 'localhost',
                    port: 5432,
                    ...userDbConfig,
                } as PostgresConnectionOptions;
        }
    } catch (e) {
        throw new ErrorWithCause('Could not parse a valid database configuration', {cause: e});
    }
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

        if(typeof rawConfig.location === 'string' && rawConfig.location.trim().toLocaleLowerCase() !== ':memory:') {
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
