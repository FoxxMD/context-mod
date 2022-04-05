import {DatabaseConfig, DatabaseDriver} from "../Common/interfaces";
import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {MongoConnectionOptions} from "typeorm/driver/mongodb/MongoConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {resolve, parse as parsePath} from 'path';
import "reflect-metadata";
import {DataSource} from "typeorm";
import {castToBool, fileOrDirectoryIsWriteable, mergeArr, resolvePath} from "../util";
import {LeveledLogMethod, Logger} from "winston";
import {CMNamingStrategy} from "./CMNamingStrategy";
import {ErrorWithCause} from "pony-cause";
import {BetterSqlite3ConnectionOptions} from "typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions";
import {WinstonAdaptor} from "typeorm-logger-adaptor/logger/winston";
import process from "process";
import {defaultDataDir} from "../Common/defaults";
import {LoggerOptions} from "typeorm/logger/LoggerOptions";


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
                    location = 'database.sqlite',
                    ...rest
                } = userDbConfig;

                return {
                    type: dbType,
                    autoSave: true, // default autoSave to true since this is most likely the expected behavior
                    location: typeof location === 'string' && location.trim().toLocaleLowerCase() !== ':memory:' ? resolvePath(location, process.env.DATA_DIR ?? defaultDataDir) : location,
                    ...rest
                } as SqljsConnectionOptions;
            case 'better-sqlite3':
                const {
                    database = 'database.sqlite',
                    ...betterRest
                } = userDbConfig;

                return {
                    type: dbType,
                    database: typeof database === 'string' && database.trim().toLocaleLowerCase() !== ':memory:' ? resolvePath(database, process.env.DATA_DIR ?? defaultDataDir) : database,
                    ...betterRest
                } as BetterSqlite3ConnectionOptions;
            case 'mysql':
            case 'mariadb':
                return {
                    type: dbType,
                    host: 'localhost',
                    port: 3306,
                    timezone: 'z',
                    // to support emojis in text columns
                    // https://stackoverflow.com/a/39465494/1469797
                    charset: 'utf8mb4',
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

export const createDatabaseConnection = async (type: 'app' | 'web', rawConfig: DatabaseConfig, logger: Logger, dbLogLevels?: LoggerOptions): Promise<DataSource> => {

    let config = {...rawConfig};

    const dbLogger = logger.child({labels: ['Database', (type === 'app' ? 'App' : 'Web')]}, mergeArr);

    dbLogger.info(`Using '${rawConfig.type}' database type`);

    if (['sqljs', 'better-sqlite3'].includes(rawConfig.type)) {

        let dbOptions: Pick<SqljsConnectionOptions, 'autoSave' | 'location'> | Pick<BetterSqlite3ConnectionOptions, 'database'>
        let dbPath: string | undefined;

        const rawPath = rawConfig.type === 'sqljs' ? rawConfig.location : rawConfig.database;

        if (typeof rawPath !== 'string' || (typeof rawPath === 'string' && rawPath.trim().toLocaleLowerCase() === ':memory:')) {
            dbLogger.info('Will use IN-MEMORY database');
        } else if (typeof rawPath === 'string' && rawPath.trim().toLocaleLowerCase() !== ':memory:') {
            try {
                let sqlLitePath = rawPath;
                if(rawConfig.type === 'sqljs') {
                    const pathInfo = parsePath(rawPath);
                    dbLogger.info(`Converting to domain-specific database file (${pathInfo.name}-${type}.sqlite) due to how sqljs works.`)
                    sqlLitePath = resolve(pathInfo.dir, `${pathInfo.name}-${type}${pathInfo.ext}`);
                }
                dbLogger.debug('Testing that database path is writeable...');
                fileOrDirectoryIsWriteable(sqlLitePath);
                dbPath = sqlLitePath;
                dbLogger.info(`Using database at path: ${sqlLitePath}`);
            } catch (e: any) {
                dbLogger.error(new ErrorWithCause(`Falling back to IN-MEMORY database due to error while trying to access database`, {cause: e}));
                if(castToBool(process.env.IS_DOCKER) === true) {
                    dbLogger.info(`Make sure you have specified user in docker run command! See https://github.com/FoxxMD/context-mod/blob/master/docs/gettingStartedOperator.md#docker-recommended`);
                }
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

    const entitiesDir = type === 'app' ? '../Common/Entities' : '../Common/WebEntities'
    const migrationsDir = type === 'app' ? '../Common/Migrations/Database/Server' : '../Common/Migrations/Database/Web';
    const migrationTable = type === 'app' ? 'migrationsApp' : 'migrationsWeb';

    const source = new DataSource({
        ...config,
        synchronize: false,
        entities: [`${resolve(__dirname, entitiesDir)}/**/*.js`],
        migrations: [`${resolve(__dirname, migrationsDir)}/*.js`],
        migrationsTableName: migrationTable,
        migrationsRun: false,
        logging: ['error', 'warn', 'migration', 'schema', 'log'],
        logger: new WinstonAdaptor(dbLogger, dbLogLevels ?? ['error', 'warn', 'schema'], false, ormLoggingAdaptorLevelMappings(dbLogger)),
        namingStrategy: new CMNamingStrategy(),
    });
    await source.initialize();
    return source;
}

const ormLoggingAdaptorLevelMappings = (logger: Logger) => ({
    log: (first: any, ...rest: any) => logger.debug(first, ...rest),
    info: (first: any, ...rest: any) => logger.info(first, ...rest),
    warn: (first: any, ...rest: any) => logger.warn(first, ...rest),
    error: (first: any, ...rest: any) => logger.error(first, ...rest),
    schema: (first: any, ...rest: any) => logger.debug(first, ...rest),
    schemaBuild: (first: any, ...rest: any) => logger.info(first, ...rest),
    query: (first: any, ...rest: any) => logger.debug(first, ...rest),
    queryError: (first: any, ...rest: any) => logger.debug(first, ...rest),
    querySlow: (first: any, ...rest: any) => logger.debug(first, ...rest),
    migration: (first: any, ...rest: any) => logger.info(first, ...rest),
});
