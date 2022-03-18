import {DatabaseConfig, DatabaseDriver} from "../Common/interfaces";
import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {MongoConnectionOptions} from "typeorm/driver/mongodb/MongoConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {resolve} from 'path';
import "reflect-metadata";
import {Connection, createConnection} from "typeorm";
import {getDatabaseLogger, getLogger} from "./loggerFactory";
import {fileOrDirectoryIsWriteable} from "../util";
import {Logger} from "winston";

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
            case 'mongodb':
                return {
                    type: 'mongodb',
                    host: 'localhost',
                    port: 27017
                } as MongoConnectionOptions;
        }
    }

    // handle sqljs db location and autoSave default
    const {type, location = resolve(`${__dirname}`, '../../database.sqlite'), ...rest} = val;
    if (type === 'sqljs') {
        return {
            type,
            location: resolve(location),
            autoSave: true, // default autoSave to true since this is most likely the expected behavior
            ...rest,
        } as SqljsConnectionOptions;
    }
    return val as DatabaseConfig;
}

export const createDatabaseConnection = async (rawConfig: DatabaseConfig, logger: Logger): Promise<Connection> => {

    let config = {...rawConfig};

    let realLocation: undefined | string = undefined;

    if (rawConfig.type === 'sqljs') {
        const location = rawConfig.location as string;

        try {
            await fileOrDirectoryIsWriteable(location);
            realLocation = location;
        } catch (e: any) {
            logger.error(`Falling back to IN-MEMORY database due to error while trying to access database file: ${e.message}`);
        }
        config = {...rawConfig, location: realLocation};
    }

    return await createConnection({
        ...config,
        synchronize: false,
        entities: [`${resolve(__dirname, '../Common/Entities')}/**/*.js`],
        migrations: [`${resolve(__dirname, '../Common/Migrations')}/Database/*.js`],
        migrationsRun: false,
        logging: ['error','warn','migration'],
        logger: getDatabaseLogger(logger, ['error','warn','migration', 'schema'])
    });
}
