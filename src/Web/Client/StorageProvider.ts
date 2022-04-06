import {SessionOptions, Store} from "express-session";
import {TypeormStore} from "connect-typeorm";
import {InviteData} from "../Common/interfaces";
import {buildCachePrefix, createCacheManager, mergeArr} from "../../util";
import {Cache} from "cache-manager";
// @ts-ignore
import CacheManagerStore from 'express-session-cache-manager'
import {CacheOptions} from "../../Common/interfaces";
import {Brackets, DataSource, IsNull, LessThanOrEqual, Repository} from "typeorm";
import {DateUtils} from 'typeorm/util/DateUtils';
import {ClientSession} from "../../Common/WebEntities/ClientSession";
import dayjs from "dayjs";
import {Logger} from "winston";
import {Invite} from "../../Common/WebEntities/Invite";
import {WebSetting} from "../../Common/WebEntities/WebSetting";
import {ErrorWithCause} from "pony-cause";

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

    inviteGet(id: string): Promise<InviteData | undefined>

    inviteDelete(id: string): Promise<void>

    inviteCreate(id: string, data: InviteData): Promise<InviteData>

    getSessionSecret(): Promise<string | undefined>

    setSessionSecret(secret: string): Promise<void>
}

interface StorageProviderOptions {
    logger: Logger
    invitesMaxAge?: number
    loggerLabels?: string[]
}

abstract class StorageProvider implements IWebStorageProvider {

    invitesMaxAge?: number
    logger: Logger;

    protected constructor(data: StorageProviderOptions) {
        const {
            logger,
            invitesMaxAge,
            loggerLabels = [],
        } = data;
        this.invitesMaxAge = invitesMaxAge;
        this.logger = logger.child({labels: ['Web', 'Storage', ...loggerLabels]}, mergeArr);
    }

    protected abstract getInvite(id: string): Promise<InviteData | undefined | null>;

    async inviteGet(id: string) {
        const data = await this.getInvite(id);
        if (data === undefined || data === null) {
            return undefined;
        }
        return data;
    }

    abstract createSessionStore(options?: CacheManagerStoreOptions | TypeormStoreOptions): Store;

    abstract getSessionSecret(): Promise<string | undefined>;

    abstract inviteCreate(id: string, data: InviteData): Promise<InviteData>;

    abstract inviteDelete(id: string): Promise<void>;

    abstract setSessionSecret(secret: string): Promise<void>;
}

export class CacheStorageProvider extends StorageProvider {

    protected cache: Cache;

    constructor(caching: CacheOptions & StorageProviderOptions) {
        super(caching);
        this.cache = createCacheManager({...caching, prefix: buildCachePrefix(['web'])}) as Cache;
        this.logger.debug('Using CACHE');
        if (caching.store === 'none') {
            this.logger.warn(`Using 'none' as cache provider means no one will be able to access the interface since sessions will never be persisted!`);
        }
    }

    createSessionStore(options?: CacheManagerStoreOptions): Store {
        return new CacheManagerStore(this.cache, {prefix: 'sess:'});
    }

    protected async getInvite(id: string) {
        return await this.cache.get(`invite:${id}`) as InviteData | undefined | null;
    }

    async inviteCreate(id: string, data: InviteData): Promise<InviteData> {
        await this.cache.set(`invite:${id}`, data, {ttl: (this.invitesMaxAge ?? 0) * 1000});
        return data;
    }

    async inviteDelete(id: string): Promise<void> {
        return await this.cache.del(`invite:${id}`);
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
    inviteRepo: Repository<Invite>;
    webSettingRepo: Repository<WebSetting>;
    clientSessionRepo: Repository<ClientSession>

    constructor(data: { database: DataSource } & StorageProviderOptions) {
        super(data);
        this.database = data.database;
        this.inviteRepo = this.database.getRepository(Invite);
        this.webSettingRepo = this.database.getRepository(WebSetting);
        this.clientSessionRepo = this.database.getRepository(ClientSession);
        this.logger.debug('Using DATABASE');
    }

    createSessionStore(options?: TypeormStoreOptions): Store {
        return new TypeormStore(options).connect(this.clientSessionRepo)
    }

    protected async getInvite(id: string): Promise<InviteData | undefined | null> {
        const qb = this.inviteRepo.createQueryBuilder('invite');
        return await qb
            .andWhere({id})
            .andWhere(new Brackets((qb) => {
                    qb.where({_expiresAt: LessThanOrEqual(DateUtils.mixedDateToDatetimeString(dayjs().toDate()))})
                        .orWhere({_expiresAt: IsNull()})
                })
            ).getOne();
    }

    async inviteCreate(id: string, data: InviteData): Promise<InviteData> {
        await this.inviteRepo.save(new Invite({...data, id}));
        return data;
    }

    async inviteDelete(id: string): Promise<void> {
        await this.inviteRepo.delete(id);
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
