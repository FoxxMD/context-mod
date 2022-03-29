import {DatabaseConfig, DatabaseDriver} from "../Common/interfaces";
import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {MongoConnectionOptions} from "typeorm/driver/mongodb/MongoConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {resolve} from 'path';
import "reflect-metadata";
import {DataSource} from "typeorm";
import {fileOrDirectoryIsWriteable, mergeArr} from "../util";
import {Logger} from "winston";
import {CMNamingStrategy} from "./CMNamingStrategy";
import {ErrorWithCause} from "pony-cause";
import {BetterSqlite3ConnectionOptions} from "typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions";
import {WinstonAdaptor} from "typeorm-logger-adaptor/logger/winston";

const validDrivers = ['sqljs', 'better-sqlite3', 'mysql', 'mariadb', 'postgres'];

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
            case 'better-sqlite3':
                const {
                    database = resolve(`${__dirname}`, '../../database.sqlite'),
                    ...betterRest
                } = userDbConfig;

                return {
                    type: dbType,
                    database: typeof database === 'string' && database.trim().toLocaleLowerCase() !== ':memory:' ? resolve(database) : database,
                    ...betterRest
                } as BetterSqlite3ConnectionOptions;
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

    const dbLogger = logger.child({labels: ['Database']}, mergeArr);

    dbLogger.info(`Using '${rawConfig.type}' database type`);

    if (['sqljs', 'better-sqlite3'].includes(rawConfig.type)) {

        let dbOptions: Pick<SqljsConnectionOptions, 'autoSave' | 'location'> | Pick<BetterSqlite3ConnectionOptions, 'database'>
        let dbPath: string | undefined;

        const rawPath = rawConfig.type === 'sqljs' ? rawConfig.location : rawConfig.database;

        if (typeof rawPath !== 'string' || (typeof rawPath === 'string' && rawPath.trim().toLocaleLowerCase() === ':memory:')) {
            dbLogger.info('Will use IN-MEMORY database');
        } else if (typeof rawPath === 'string' && rawPath.trim().toLocaleLowerCase() !== ':memory:') {
            try {
                dbLogger.debug('Testing that database path is writeable...');
                await fileOrDirectoryIsWriteable(rawPath);
                dbPath = rawPath;
                dbLogger.info(`Using database at path: ${dbPath}`);
            } catch (e: any) {
                dbLogger.error(new ErrorWithCause(`Falling back to IN-MEMORY database due to error while trying to access database file at ${rawPath})`, {cause: e}));
            }
        }

        if (rawConfig.type === 'sqljs') {
            dbOptions = {
                autoSave: dbPath !== undefined,
                location: dbPath
            };
        } else {
            dbOptions = {
                database: dbPath ?? ':memory:'
            }
        }

        config = {...config, ...dbOptions} as SqljsConnectionOptions | BetterSqlite3ConnectionOptions;
    }

    const source = new DataSource({
        ...config,
        synchronize: false,
        entities: [`${resolve(__dirname, '../Common/Entities')}/**/*.js`],
        migrations: [`${resolve(__dirname, '../Common/Migrations')}/Database/*.js`],
        migrationsRun: false,
        logging: ['error', 'warn', 'migration'],
        logger: new WinstonAdaptor(dbLogger, ['error', 'warn', 'migration', 'schema']),
        namingStrategy: new CMNamingStrategy(),
    });
    await source.initialize();
    return source;
}
