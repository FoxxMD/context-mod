import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {MongoConnectionOptions} from "typeorm/driver/mongodb/MongoConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {resolve, parse as parsePath} from 'path';
// https://stackoverflow.com/questions/49618719/why-does-typeorm-need-reflect-metadata
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
import {DataSourceOptions} from "typeorm/data-source/DataSourceOptions";
import {DatabaseConfig, DatabaseDriverType} from "../Common/Infrastructure/Database";


const validDrivers = ['sqljs', 'better-sqlite3', 'mysql', 'mariadb', 'postgres'];

export const isDatabaseDriver = (val: any): val is DatabaseDriverType => {
    if (typeof val !== 'string') {
        return false;
    }
    return validDrivers.some(x => x === val.toLocaleLowerCase());
}

export const asDatabaseDriver = (val: string): DatabaseDriverType => {
    const cleanVal = val.trim().toLocaleLowerCase();
    if(isDatabaseDriver(cleanVal)) {
        return cleanVal;
    }
    throw new Error(`Value '${cleanVal}' is not a valid driver. Must be one of: ${validDrivers.join(', ')}`);
}

export const createDatabaseConfig = (val: DatabaseDriverType | any): DatabaseConfig => {
    try {
        let dbType: DatabaseDriverType;
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

type DomainSpecificDataSourceOptions = Required<Pick<DataSourceOptions, 'migrations' | 'migrationsTableName' | 'entities'>>;

export const createDatabaseConnection = async (rawConfig: DatabaseConfig, domainOptions: DomainSpecificDataSourceOptions, logger: Logger): Promise<DataSource> => {

    let config = {...rawConfig};

    const dbLogger = logger.child({labels: ['Database']}, mergeArr);

    dbLogger.info(`Using '${rawConfig.type}' database type`);

    if(rawConfig.type === 'sqljs') {
        dbLogger.warn(`sqljs SHOULD NOT be used in a production environment. Consider switching to 'better-sqlite3' for better performance. Preferably 'mysql', 'mariadb', or 'postgres' for best performance and security.`);
    }

    if (['sqljs', 'better-sqlite3'].includes(rawConfig.type)) {

        let dbOptions: Pick<SqljsConnectionOptions, 'autoSave' | 'location'> | Pick<BetterSqlite3ConnectionOptions, 'database'>
        let dbPath: string | undefined;

        const rawPath = rawConfig.type === 'sqljs' ? rawConfig.location : rawConfig.database;

        if (typeof rawPath !== 'string' || (typeof rawPath === 'string' && rawPath.trim().toLocaleLowerCase() === ':memory:')) {
            dbLogger.warn('Will use IN-MEMORY database. All data will be lost on application restart.');
        } else {
            try {
                dbLogger.debug('Testing that database path is writeable...');
                fileOrDirectoryIsWriteable(rawPath);
                dbPath = rawPath;
                dbLogger.verbose(`Using database at path: ${rawPath}`);
            } catch (e: any) {
                dbLogger.error(new ErrorWithCause(`Falling back to IN-MEMORY database due to error while trying to access database. All data will be lost on application restart`, {cause: e}));
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

    const {
        logging = ['error', 'warn', 'schema'],
        ...rest
    } = config;

    let logTypes: any = logging;
    if(logTypes === true) {
        logTypes = ['ALL (logging=true)'];
    } else if (logTypes === false) {
        logTypes = ['NONE (logging=false)'];
    }
    dbLogger.debug(`Will log the follow types from typeorm: ${logTypes.join(', ')}`);

    const source = new DataSource({
        ...rest,
        synchronize: false,
        ...domainOptions,
        migrationsRun: false,
        logging: ['error', 'warn', 'migration', 'schema', 'log'],
        logger: new WinstonAdaptor(dbLogger, logging, false, ormLoggingAdaptorLevelMappings(dbLogger)),
        namingStrategy: new CMNamingStrategy(),
    });
    await source.initialize();
    return source;
}

export const convertSqlJsLocation = (suffix: string, rawConfig: DatabaseConfig, logger: Logger) => {
    if (rawConfig.type === 'sqljs' && typeof rawConfig.location === 'string' && rawConfig.location.trim().toLocaleLowerCase() !== ':memory:' && !rawConfig.location.toLocaleLowerCase().includes(suffix)) {
        const pathInfo = parsePath(rawConfig.location);
        const suffixedFilename = `${pathInfo.name}-${suffix}${pathInfo.ext}`;
        logger.debug(`To prevent web and app databases from overwriting each other (when using sqljs) the database location will be changed to be domain-specific: ${pathInfo.name}${pathInfo.ext} => ${suffixedFilename} -- this may be disabled by including the word '${suffix}' in your original filepath location.`, {leaf: 'Database'});
        return {...rawConfig, location: resolve(pathInfo.dir, suffixedFilename)}
    }
    return rawConfig;
}

export const domainDatabaseOptions = {
    app: {
        entities: '../Common/Entities',
        migrations: '../Common/Migrations/Database/Server',
        migrationsTableName: 'migrationsApp'
    },
    web: {
        entities: '../Common/WebEntities',
        migrations: '../Common/Migrations/Database/Web',
        migrationsTableName: 'migrationsWeb'
    }
}

export const createAppDatabaseConnection = async (rawConfig: DatabaseConfig, logger: Logger) => {
    const domainLogger = logger.child({labels: ['App']}, mergeArr);
    return createDatabaseConnection(convertSqlJsLocation('app', rawConfig, domainLogger), {
        entities: [`${resolve(__dirname, domainDatabaseOptions.app.entities)}/**/*.js`],
        migrations: [`${resolve(__dirname, domainDatabaseOptions.app.migrations)}/*.js`],
        migrationsTableName: domainDatabaseOptions.app.migrationsTableName
    }, domainLogger);
}

export const createWebDatabaseConnection = async (rawConfig: DatabaseConfig, logger: Logger) => {
    const domainLogger = logger.child({labels: ['Web']}, mergeArr);
    return createDatabaseConnection(convertSqlJsLocation('web', rawConfig, domainLogger), {
        entities: [`${resolve(__dirname, domainDatabaseOptions.web.entities)}/**/*.js`],
        migrations: [`${resolve(__dirname, domainDatabaseOptions.web.migrations)}/*.js`],
        migrationsTableName: domainDatabaseOptions.web.migrationsTableName
    }, domainLogger);
}

const ormLoggingAdaptorLevelMappings = (logger: Logger) => {
    const migrationLogger = logger.child({labels: ['Migration']}, mergeArr);
    return {
        log: (first: any, ...rest: any) => logger.debug(first, ...rest),
        info: (first: any, ...rest: any) => logger.info(first, ...rest),
        warn: (first: any, ...rest: any) => logger.warn(first, ...rest),
        error: (first: any, ...rest: any) => logger.error(first, ...rest),
        schema: (first: any, ...rest: any) => logger.debug(first, ...rest),
        schemaBuild: (first: any, ...rest: any) => migrationLogger.info(first, ...rest),
        query: (first: any, ...rest: any) => logger.debug(first, ...rest),
        queryError: (first: any, ...rest: any) => logger.debug(first, ...rest),
        querySlow: (first: any, ...rest: any) => logger.debug(first, ...rest),
        migration: (first: any, ...rest: any) => migrationLogger.info(first, ...rest),
    }
};
