import {SPoll} from "../Subreddit/Streams";
import Snoowrap from "snoowrap";
import {Cache} from "cache-manager";
import {
    BotInstanceConfig,
    StrongCache,
    StrongTTLConfig,
    ThirdPartyCredentialsJsonConfig,
    TTLConfig
} from "../Common/interfaces";
import winston, {Logger} from "winston";
import {DataSource, Repository} from "typeorm";
import {
    EventRetentionPolicyRange
} from "../Common/Infrastructure/Atomic";
import {InvokeeType} from "../Common/Entities/InvokeeType";
import {RunStateType} from "../Common/Entities/RunStateType";
import {buildCachePrefix, cacheStats, mergeArr, toStrongTTLConfig} from "../util";
import objectHash from "object-hash";
import {runMigrations} from "../Common/Migrations/CacheMigrationUtils";
import {CMError} from "../Utils/Errors";
import {DEFAULT_FOOTER, SubredditResources} from "../Subreddit/SubredditResources";
import {SubredditResourceConfig, SubredditResourceOptions} from "../Common/Subreddit/SubredditResourceInterfaces";
import {buildCacheOptionsFromProvider, CMCache, createCacheManager} from "../Common/Cache";

export class BotResourcesManager {
    resources: Map<string, SubredditResources> = new Map();
    authorTTL: number = 10000;
    enabled: boolean = true;
    modStreams: Map<string, SPoll<Snoowrap.Submission | Snoowrap.Comment>> = new Map();
    defaultCache: CMCache;
    defaultCacheConfig: StrongCache
    defaultCacheMigrated: boolean = false;
    cacheType: string = 'none';
    cacheHash: string;
    ttlDefaults: StrongTTLConfig
    defaultThirdPartyCredentials: ThirdPartyCredentialsJsonConfig;
    logger: Logger;
    botAccount?: string;
    defaultDatabase: DataSource
    botName!: string
    retention?: EventRetentionPolicyRange

    invokeeRepo: Repository<InvokeeType>
    runTypeRepo: Repository<RunStateType>

    constructor(config: BotInstanceConfig, logger: Logger) {
        const {
            caching: {
                authorTTL,
                userNotesTTL,
                wikiTTL,
                commentTTL,
                submissionTTL,
                subredditTTL,
                filterCriteriaTTL,
                modNotesTTL,
                selfTTL,
                provider,
            },
            name,
            credentials: {
                reddit,
                ...thirdParty
            },
            database,
            databaseConfig: {
                retention
            } = {},
            caching,
        } = config;
        caching.provider.prefix = buildCachePrefix([caching.provider.prefix, 'SHARED']);
        const {...relevantCacheSettings} = caching;
        this.cacheHash = objectHash.sha1(relevantCacheSettings);
        this.defaultCacheConfig = caching;
        this.defaultThirdPartyCredentials = thirdParty;
        this.defaultDatabase = database;
        this.ttlDefaults = toStrongTTLConfig({
            authorTTL,
            userNotesTTL,
            wikiTTL,
            commentTTL,
            submissionTTL,
            filterCriteriaTTL,
            subredditTTL,
            selfTTL,
            modNotesTTL
        });
        this.botName = name as string;
        this.logger = logger;
        this.invokeeRepo = this.defaultDatabase.getRepository(InvokeeType);
        this.runTypeRepo = this.defaultDatabase.getRepository(RunStateType);
        this.retention = retention;

        const options = provider;
        this.cacheType = options.store;

        const cache = createCacheManager(options);
        this.defaultCache = new CMCache(cache, options, true, caching.provider.prefix, this.ttlDefaults, this.logger);
    }

    get(subName: string): SubredditResources | undefined {
        if (this.resources.has(subName)) {
            return this.resources.get(subName) as SubredditResources;
        }
        return undefined;
    }

    async set(subName: string, initOptions: SubredditResourceConfig): Promise<SubredditResources> {
        let hash = 'default';
        const {caching, credentials, retention, ...init} = initOptions;

        const res = this.get(subName);

        let opts: SubredditResourceOptions = {
            cache: this.defaultCache,
            cacheType: this.cacheType,
            cacheSettingsHash: hash,
            ttl: this.ttlDefaults,
            thirdPartyCredentials: credentials ?? this.defaultThirdPartyCredentials,
            prefix: this.defaultCacheConfig.provider.prefix,
            database: this.defaultDatabase,
            botName: this.botName,
            retention: retention ?? this.retention,
            ...init,
        };

        if (caching !== undefined) {
            const {
                provider = this.defaultCacheConfig.provider,
                ...rest
            } = caching;
            
            opts.ttl = toStrongTTLConfig({
                ...this.ttlDefaults,
                ...rest
            });
            
            const candidateProvider = buildCacheOptionsFromProvider(provider);

            const defaultPrefix = candidateProvider.prefix;
            const subPrefix = defaultPrefix === this.defaultCacheConfig.provider.prefix ? buildCachePrefix([(defaultPrefix !== undefined ? defaultPrefix.replace('SHARED', '') : defaultPrefix), subName]) : candidateProvider.prefix;
            candidateProvider.prefix = subPrefix;

            if(this.defaultCache.equalProvider(candidateProvider)) {
                opts.cache = this.defaultCache;
            } else if(res !== undefined && res.cache.equalProvider(candidateProvider)) {
                opts.cache = res.cache;
            } else {
                opts.cache = new CMCache(createCacheManager(candidateProvider), candidateProvider, false, this.defaultCache.providerOptions.prefix, opts.ttl, this.logger);
                await runMigrations(opts.cache.cache, opts.cache.logger, candidateProvider.prefix);
            }

        } else if (!this.defaultCacheMigrated) {
            await runMigrations(this.defaultCache.cache, this.logger, opts.prefix);
            this.defaultCacheMigrated = true;
        }

        let resource: SubredditResources;
        if (res === undefined) {
            resource = new SubredditResources(subName, {
                ...opts,
                botAccount: this.botAccount
            });
            this.resources.set(subName, resource);
        } else {
            // just set non-cache related settings
            resource = res;
            resource.botAccount = this.botAccount;
        }
        await resource.configure(opts);

        return resource;
    }

    async destroy(subName: string) {
        const res = this.get(subName);
        if (res !== undefined) {
            await res.destroy();
            this.resources.delete(subName);
        }
    }

    async getPendingSubredditInvites(): Promise<(string[])> {
        const subredditNames = await this.defaultCache.get(`modInvites`);
        if (subredditNames !== undefined && subredditNames !== null) {
            return subredditNames as string[];
        }
        return [];
    }

    async addPendingSubredditInvite(subreddit: string): Promise<void> {
        if (subreddit === null || subreddit === undefined || subreddit == '') {
            throw new CMError('Subreddit name cannot be empty');
        }
        let subredditNames = await this.defaultCache.get(`modInvites`) as (string[] | undefined | null);
        if (subredditNames === undefined || subredditNames === null) {
            subredditNames = [];
        }
        const cleanName = subreddit.trim();

        if (subredditNames.some(x => x.trim().toLowerCase() === cleanName.toLowerCase())) {
            throw new CMError(`An invite for the Subreddit '${subreddit}' already exists`);
        }
        subredditNames.push(cleanName);
        await this.defaultCache.set(`modInvites`, subredditNames, {ttl: 0});
        return;
    }

    async deletePendingSubredditInvite(subreddit: string): Promise<void> {
        let subredditNames = await this.defaultCache.get(`modInvites`) as (string[] | undefined | null);
        if (subredditNames === undefined || subredditNames === null) {
            subredditNames = [];
        }
        subredditNames = subredditNames.filter(x => x.toLowerCase() !== subreddit.trim().toLowerCase());
        await this.defaultCache.set(`modInvites`, subredditNames, {ttl: 0});
        return;
    }

    async clearPendingSubredditInvites(): Promise<void> {
        await this.defaultCache.del(`modInvites`);
        return;
    }
}
