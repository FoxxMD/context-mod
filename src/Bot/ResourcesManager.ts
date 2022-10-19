import {SPoll} from "../Subreddit/Streams";
import Snoowrap from "snoowrap";
import {Cache} from "cache-manager";
import {BotInstanceConfig, StrongCache, ThirdPartyCredentialsJsonConfig, TTLConfig} from "../Common/interfaces";
import winston, {Logger} from "winston";
import {DataSource, Repository} from "typeorm";
import {
    EventRetentionPolicyRange
} from "../Common/Infrastructure/Atomic";
import {InvokeeType} from "../Common/Entities/InvokeeType";
import {RunStateType} from "../Common/Entities/RunStateType";
import {buildCacheOptionsFromProvider, buildCachePrefix, cacheStats, createCacheManager} from "../util";
import objectHash from "object-hash";
import {runMigrations} from "../Common/Migrations/CacheMigrationUtils";
import {CMError} from "../Utils/Errors";
import {DEFAULT_FOOTER, SubredditResources} from "../Subreddit/SubredditResources";
import {SubredditResourceConfig, SubredditResourceOptions} from "../Common/Subreddit/SubredditResourceInterfaces";

export class BotResourcesManager {
    resources: Map<string, SubredditResources> = new Map();
    authorTTL: number = 10000;
    enabled: boolean = true;
    modStreams: Map<string, SPoll<Snoowrap.Submission | Snoowrap.Comment>> = new Map();
    defaultCache: Cache;
    defaultCacheConfig: StrongCache
    defaultCacheMigrated: boolean = false;
    cacheType: string = 'none';
    cacheHash: string;
    ttlDefaults: Required<TTLConfig>;
    actionedEventsMaxDefault?: number;
    actionedEventsDefault: number;
    pruneInterval: any;
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
                actionedEventsMax,
                actionedEventsDefault,
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
        const {actionedEventsMax: eMax, actionedEventsDefault: eDef, ...relevantCacheSettings} = caching;
        this.cacheHash = objectHash.sha1(relevantCacheSettings);
        this.defaultCacheConfig = caching;
        this.defaultThirdPartyCredentials = thirdParty;
        this.defaultDatabase = database;
        this.ttlDefaults = {
            authorTTL,
            userNotesTTL,
            wikiTTL,
            commentTTL,
            submissionTTL,
            filterCriteriaTTL,
            subredditTTL,
            selfTTL,
            modNotesTTL
        };
        this.botName = name as string;
        this.logger = logger;
        this.invokeeRepo = this.defaultDatabase.getRepository(InvokeeType);
        this.runTypeRepo = this.defaultDatabase.getRepository(RunStateType);
        this.retention = retention;

        const options = provider;
        this.cacheType = options.store;
        this.actionedEventsMaxDefault = actionedEventsMax;
        this.actionedEventsDefault = actionedEventsDefault;
        this.defaultCache = createCacheManager(options);
        if (this.cacheType === 'memory') {
            const min = Math.min(...([this.ttlDefaults.wikiTTL, this.ttlDefaults.authorTTL, this.ttlDefaults.userNotesTTL].filter(x => typeof x === 'number' && x !== 0) as number[]));
            if (min > 0) {
                // set default prune interval
                this.pruneInterval = setInterval(() => {
                    // @ts-ignore
                    this.defaultCache?.store.prune();
                    // kinda hacky but whatever
                    const logger = winston.loggers.get('app');
                    logger.debug('Pruned Shared Cache');
                    // prune interval should be twice the smallest TTL
                }, min * 1000 * 2)
            }
        }
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

        // const bEntity = await this.defaultDatabase.getRepository(Bot).findOne({where: {name: this.botName}}) as Bot;
        // //const subreddit = this.defaultDatabase.getRepository(SubredditEntity).findOne({name: initOptions.subreddit.display_name});
        // const mEntity = await this.defaultDatabase.getRepository(Manager).findOne({
        //     where: {
        //         name: subName,
        //         bot: {
        //             id: bEntity.id
        //         }
        //     },
        //     relations: ['bot']
        // });

        let opts: SubredditResourceOptions = {
            cache: this.defaultCache,
            cacheType: this.cacheType,
            cacheSettingsHash: hash,
            ttl: this.ttlDefaults,
            thirdPartyCredentials: credentials ?? this.defaultThirdPartyCredentials,
            prefix: this.defaultCacheConfig.provider.prefix,
            actionedEventsMax: this.actionedEventsMaxDefault !== undefined ? Math.min(this.actionedEventsDefault, this.actionedEventsMaxDefault) : this.actionedEventsDefault,
            database: this.defaultDatabase,
            botName: this.botName,
            retention: retention ?? this.retention,
            ...init,
        };

        if (caching !== undefined) {
            const {
                provider = this.defaultCacheConfig.provider,
                actionedEventsMax = this.actionedEventsDefault,
                ...rest
            } = caching;
            let cacheConfig = {
                provider: buildCacheOptionsFromProvider(provider),
                ttl: {
                    ...this.ttlDefaults,
                    ...rest
                },
            }
            hash = objectHash.sha1(cacheConfig);
            // only need to create private if there settings are actually different than the default
            if (hash !== this.cacheHash) {
                const {provider: trueProvider, ...trueRest} = cacheConfig;
                const defaultPrefix = trueProvider.prefix;
                const subPrefix = defaultPrefix === this.defaultCacheConfig.provider.prefix ? buildCachePrefix([(defaultPrefix !== undefined ? defaultPrefix.replace('SHARED', '') : defaultPrefix), subName]) : trueProvider.prefix;
                trueProvider.prefix = subPrefix;
                const eventsMax = this.actionedEventsMaxDefault !== undefined ? Math.min(actionedEventsMax, this.actionedEventsMaxDefault) : actionedEventsMax;
                opts = {
                    cache: createCacheManager(trueProvider),
                    actionedEventsMax: eventsMax,
                    cacheType: trueProvider.store,
                    cacheSettingsHash: hash,
                    thirdPartyCredentials: credentials ?? this.defaultThirdPartyCredentials,
                    prefix: subPrefix,
                    botName: this.botName,
                    database: this.defaultDatabase,
                    retention: retention ?? this.retention,
                    ...init,
                    ...trueRest,
                };
                await runMigrations(opts.cache, opts.logger, trueProvider.prefix);
            }
        } else if (!this.defaultCacheMigrated) {
            await runMigrations(this.defaultCache, this.logger, opts.prefix);
            this.defaultCacheMigrated = true;
        }

        let resource: SubredditResources;
        const res = this.get(subName);
        if (res === undefined || res.cacheSettingsHash !== hash) {
            resource = new SubredditResources(subName, {
                ...opts,
                delayedItems: res?.delayedItems,
                botAccount: this.botAccount
            });
            await resource.initStats();
            resource.setHistoricalSaveInterval();
            this.resources.set(subName, resource);
        } else {
            // just set non-cache related settings
            resource = res;
            resource.botAccount = this.botAccount;
            if (opts.footer !== resource.footer) {
                resource.footer = opts.footer || DEFAULT_FOOTER;
            }
            // reset cache stats when configuration is reloaded
            resource.subredditStats.stats.cache = cacheStats();
        }
        await resource.initDatabaseDelayedActivities();

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
