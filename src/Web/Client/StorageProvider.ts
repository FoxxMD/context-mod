import {SessionOptions, Store} from "express-session";
import {TypeormStore} from "connect-typeorm";
import {InviteData} from "../Common/interfaces";
import {buildCachePrefix, mergeArr} from "../../util";
import {Cache} from "cache-manager";
// @ts-ignore
import CacheManagerStore from 'express-session-cache-manager'
import {CacheOptions} from "../../Common/interfaces";
import {Brackets, DataSource, IsNull, LessThanOrEqual, Repository} from "typeorm";
import {ClientSession} from "../../Common/WebEntities/ClientSession";
import {Logger} from "winston";
import {WebSetting} from "../../Common/WebEntities/WebSetting";
import {ErrorWithCause} from "pony-cause";
import {createCacheManager} from "../../Common/Cache";
import {MysqlDriver} from "typeorm/driver/mysql/MysqlDriver";

export interface CacheManagerStoreOptions {
    prefix?: string
}

export type TypeormStoreOptions = Partial<SessionOptions & {
    cleanupLimit: number;
    limitSubquery: boolean;
    onError: (s: TypeormStore, e: Error) => void;
    ttl: number | ((store: TypeormStore, sess: any, sid?: string) => number);
}>;

interface IWebStorageProvider {
    createSessionStore(options?: CacheManagerStoreOptions | TypeormStoreOptions): Store

    getSessionSecret(): Promise<string | undefined>

    setSessionSecret(secret: string): Promise<void>
}

interface StorageProviderOptions {
    logger: Logger
    loggerLabels?: string[]
}

abstract class StorageProvider implements IWebStorageProvider {

    logger: Logger;

    protected constructor(data: StorageProviderOptions) {
        const {
            logger,
            loggerLabels = [],
        } = data;
        this.logger = logger.child({labels: ['Web', 'Storage', ...loggerLabels]}, mergeArr);
    }

    abstract createSessionStore(options?: CacheManagerStoreOptions | TypeormStoreOptions): Store;

    abstract getSessionSecret(): Promise<string | undefined>;

    abstract setSessionSecret(secret: string): Promise<void>;
}

export class CacheStorageProvider extends StorageProvider {

    protected cache: Cache;

    constructor(caching: CacheOptions & StorageProviderOptions) {
        super(caching);
        const {logger, invitesMaxAge, loggerLabels, ...restCache } = caching;
        this.cache = createCacheManager({...restCache, prefix: buildCachePrefix(['web'])}) as Cache;
        this.logger.debug('Using CACHE');
        if (caching.store === 'none') {
            this.logger.warn(`Using 'none' as cache provider means no one will be able to access the interface since sessions will never be persisted!`);
        }
    }

    createSessionStore(options?: CacheManagerStoreOptions): Store {
        return new CacheManagerStore(this.cache, {prefix: 'sess:'});
    }

    async getSessionSecret() {
        const val = await this.cache.get(`sessionSecret`);
        if (val === null || val === undefined) {
            return undefined;
        }
        return val as string;
    }

    async setSessionSecret(secret: string) {
        await this.cache.set('sessionSecret', secret, {ttl: 0});
    }

}

export class DatabaseStorageProvider extends StorageProvider {

    database: DataSource;
    webSettingRepo: Repository<WebSetting>;
    clientSessionRepo: Repository<ClientSession>

    constructor(data: { database: DataSource } & StorageProviderOptions) {
        super(data);
        this.database = data.database;
        this.webSettingRepo = this.database.getRepository(WebSetting);
        this.clientSessionRepo = this.database.getRepository(ClientSession);
        this.logger.debug('Using DATABASE');
    }

    createSessionStore(options?: TypeormStoreOptions): Store {
        // https://github.com/freshgiammi-lab/connect-typeorm#implement-the-session-entity
        // https://github.com/freshgiammi-lab/connect-typeorm/issues/8
        // usage of LIMIT in subquery is not supported by mariadb/mysql
        // limitSubquery: false -- turns off LIMIT usage
        const realOptions = this.database.driver instanceof MysqlDriver ? {...options, limitSubquery: false} : options;
        return new TypeormStore(realOptions).connect(this.clientSessionRepo)
    }

    async getSessionSecret(): Promise<string | undefined> {
        try {
            const dbSessionSecret = await this.webSettingRepo.findOneBy({name: 'sessionSecret'});
            if (dbSessionSecret === null) {
                return undefined;
            }
            return dbSessionSecret.value;
        } catch (e) {
            throw new ErrorWithCause('Unable to retrieve session secret from database', {cause: e});
        }
    }

    async setSessionSecret(secret: string): Promise<void> {
        try {
            await this.webSettingRepo.save(new WebSetting({name: 'sessionSecret', value: secret}));
        } catch (e) {
            throw new ErrorWithCause('Unable to insert session secret into database', {cause: e});
        }
    }

}
