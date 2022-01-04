import {DatabaseConfig, DatabaseDriver} from "../Common/interfaces";
import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {MongoConnectionOptions} from "typeorm/driver/mongodb/MongoConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {resolve} from 'path';
import "reflect-metadata";
import {Connection, createConnection} from "typeorm";
import fs, {promises, constants} from "fs";
import {parse} from 'path';
import {getLogger} from "./loggerFactory";
import SimpleError from "./SimpleError";

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

export const createDatabaseConnection = async (rawConfig: DatabaseConfig): Promise<Connection> => {

    let config = {...rawConfig};

    const logger = getLogger({}, 'app');

    let realLocation: undefined | string = undefined;

    if (rawConfig.type === 'sqljs') {
        const location = rawConfig.location as string;
        // check if directory or file is read/writeable
        const pathInfo = parse(location);
        try {
            await promises.access(location, constants.R_OK | constants.W_OK);
            realLocation = location;
        } catch (err: any) {
            const {code} = err;
            if (code === 'ENOENT') {
                // file doesn't exist, see if we can write to directory in which case we are good
                try {
                    await promises.access(pathInfo.dir, constants.R_OK | constants.W_OK)
                    // we can write to dir
                    realLocation = location;
                } catch (accessError: any) {
                    // also can't access directory :(
                    logger.warn(`Database file at ${location} did not exist and application does not have permission to write to that directory. Falling back to IN-MEMORY database.`);
                }
            } else {
                logger.error(err);
                throw new SimpleError(`Database file exists at ${location} but application does have permission to write to it!`);
            }
        }
        config = {...rawConfig, location: realLocation};
    }

    return await createConnection({...config, synchronize: true});
}
