import Snoowrap from "snoowrap";
import objectHash from 'object-hash';
import {
    activityIsDeleted, activityIsFiltered,
    activityIsRemoved,
    AuthorActivitiesOptions,
    AuthorTypedActivitiesOptions, BOT_LINK,
    getAuthorActivities
} from "../Utils/SnoowrapUtils";
import winston, {Logger} from "winston";
import as from 'async';
import fetch from 'node-fetch';
import {
    asActivity,
    asSubmission, asUserNoteCriteria,
    buildCacheOptionsFromProvider,
    buildCachePrefix,
    cacheStats,
    compareDurationValue,
    comparisonTextOp,
    createCacheManager,
    createHistoricalStatsDisplay, escapeRegex, FAIL,
    fetchExternalUrl, filterCriteriaSummary,
    formatNumber, generateItemFilterHelpers,
    getActivityAuthorName,
    getActivitySubredditName, isComment, isCommentState,
    isStrongSubredditState, isSubmission, isUser,
    mergeArr,
    parseDurationComparison,
    parseExternalUrl,
    parseGenericValueComparison, parseGenericValueOrPercentComparison,
    parseRedditEntity, parseStringToRegex,
    parseWikiContext, PASS, redisScanIterator, removeUndefinedKeys,
    shouldCacheSubredditStateCriteriaResult, strToActivitySource,
    subredditStateIsNameOnly, testMaybeStringRegex,
    toStrongSubredditState, truncateStringToLength, userNoteCriteriaSummary
} from "../util";
import LoggedError from "../Utils/LoggedError";
import {
    BotInstanceConfig,
    CacheOptions,
    CommentState,
    Footer,
    OperatorConfig,
    ResourceStats,
    StrongCache,
    SubmissionState,
    CacheConfig,
    TTLConfig,
    TypedActivityStates,
    UserResultCache,
    ActionedEvent,
    SubredditState,
    StrongSubredditState,
    HistoricalStats,
    HistoricalStatUpdateData,
    SubredditHistoricalStats,
    SubredditHistoricalStatsDisplay,
    ThirdPartyCredentialsJsonConfig,
    FilterCriteriaResult,
    FilterResult,
    TypedActivityState,
    RequiredItemCrit,
    ItemCritPropHelper,
    ActivityDispatch,
    FilterCriteriaPropertyResult,
    ActivitySource, ModeratorNameCriteria,
} from "../Common/interfaces";
import UserNotes from "./UserNotes";
import Mustache from "mustache";
import he from "he";
import {AuthorCriteria, AuthorOptions} from "../Author/Author";
import {SPoll} from "./Streams";
import {Cache} from 'cache-manager';
import {Submission, Comment, Subreddit, RedditUser} from "snoowrap/dist/objects";
import {cacheTTLDefaults, createHistoricalDefaults, historicalDefaults} from "../Common/defaults";
import {check} from "tcp-port-used";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";
import dayjs from "dayjs";
import ImageData from "../Common/ImageData";
import globrex from 'globrex';
import {runMigrations} from "../Common/Migrations/CacheMigrationUtils";
import {isStatusError, SimpleError} from "../Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {UserNoteCriteria} from "../Rule";
import {AuthorCritPropHelper, RequiredAuthorCrit} from "../Common/types";

export const DEFAULT_FOOTER = '\r\n*****\r\nThis action was performed by [a bot.]({{botLink}}) Mention a moderator or [send a modmail]({{modmailLink}}) if you any ideas, questions, or concerns about this action.';

export interface SubredditResourceConfig extends Footer {
    caching?: CacheConfig,
    subreddit: Subreddit,
    logger: Logger;
    client: ExtendedSnoowrap
    credentials?: ThirdPartyCredentialsJsonConfig
}

interface SubredditResourceOptions extends Footer {
    ttl: Required<TTLConfig>
    cache: Cache
    cacheType: string;
    cacheSettingsHash: string
    subreddit: Subreddit,
    logger: Logger;
    client: ExtendedSnoowrap;
    prefix?: string;
    actionedEventsMax: number;
    thirdPartyCredentials: ThirdPartyCredentialsJsonConfig
    delayedItems?: ActivityDispatch[]
    botAccount?: string
}

export interface SubredditResourceSetOptions extends CacheConfig, Footer {
}

export class SubredditResources {
    //enabled!: boolean;
    protected useSubredditAuthorCache!: boolean;
    protected authorTTL: number | false = cacheTTLDefaults.authorTTL;
    protected subredditTTL: number | false = cacheTTLDefaults.subredditTTL;
    protected wikiTTL: number | false = cacheTTLDefaults.wikiTTL;
    protected submissionTTL: number | false = cacheTTLDefaults.submissionTTL;
    protected commentTTL: number | false = cacheTTLDefaults.commentTTL;
    protected filterCriteriaTTL: number | false = cacheTTLDefaults.filterCriteriaTTL;
    public selfTTL: number | false = cacheTTLDefaults.selfTTL;
    name: string;
    protected logger: Logger;
    userNotes: UserNotes;
    footer: false | string = DEFAULT_FOOTER;
    subreddit: Subreddit
    client: ExtendedSnoowrap
    cache: Cache
    cacheType: string
    cacheSettingsHash?: string;
    pruneInterval?: any;
    historicalSaveInterval?: any;
    prefix?: string
    actionedEventsMax: number;
    thirdPartyCredentials: ThirdPartyCredentialsJsonConfig;
    delayedItems: ActivityDispatch[] = [];
    botAccount?: string;

    stats: {
        cache: ResourceStats
        historical: SubredditHistoricalStats
    };

    constructor(name: string, options: SubredditResourceOptions) {
        const {
            subreddit,
            logger,
            ttl: {
                userNotesTTL,
                authorTTL,
                wikiTTL,
                filterCriteriaTTL,
                selfTTL,
                submissionTTL,
                commentTTL,
                subredditTTL,
            },
            cache,
            prefix,
            cacheType,
            actionedEventsMax,
            cacheSettingsHash,
            client,
            thirdPartyCredentials,
            delayedItems = [],
            botAccount,
        } = options || {};

        this.delayedItems = delayedItems;
        this.cacheSettingsHash = cacheSettingsHash;
        this.cache = cache;
        this.prefix = prefix;
        this.client = client;
        this.cacheType = cacheType;
        this.actionedEventsMax = actionedEventsMax;
        this.authorTTL = authorTTL === true ? 0 : authorTTL;
        this.submissionTTL = submissionTTL === true ? 0 : submissionTTL;
        this.commentTTL = commentTTL === true ? 0 : commentTTL;
        this.subredditTTL = subredditTTL === true ? 0 : subredditTTL;
        this.wikiTTL = wikiTTL === true ? 0 : wikiTTL;
        this.filterCriteriaTTL = filterCriteriaTTL === true ? 0 : filterCriteriaTTL;
        this.selfTTL = selfTTL === true ? 0 : selfTTL;
        this.subreddit = subreddit;
        this.thirdPartyCredentials = thirdPartyCredentials;
        this.name = name;
        this.botAccount = botAccount;
        if (logger === undefined) {
            const alogger = winston.loggers.get('app')
            this.logger = alogger.child({labels: [this.name, 'Resource Cache']}, mergeArr);
        } else {
            this.logger = logger.child({labels: ['Resource Cache']}, mergeArr);
        }

        this.stats = {
            cache: cacheStats(),
            historical: {
                allTime: createHistoricalDefaults(),
                lastReload: createHistoricalDefaults()
            }
        };

        const cacheUseCB = (miss: boolean) => {
            this.stats.cache.userNotes.requestTimestamps.push(Date.now());
            this.stats.cache.userNotes.requests++;
            this.stats.cache.userNotes.miss += miss ? 1 : 0;
        }
        this.userNotes = new UserNotes(userNotesTTL, this.subreddit.display_name, this.client, this.logger, this.cache, cacheUseCB)

        if(this.cacheType === 'memory' && this.cacheSettingsHash !== 'default') {
            const min = Math.min(...([this.wikiTTL, this.authorTTL, this.submissionTTL, this.commentTTL, this.filterCriteriaTTL].filter(x => typeof x === 'number' && x !== 0) as number[]));
            if(min > 0) {
                // set default prune interval
                this.pruneInterval = setInterval(() => {
                    // @ts-ignore
                    this.defaultCache?.store.prune();
                    this.logger.debug('Pruned cache');
                    // prune interval should be twice the smallest TTL
                },min * 1000 * 2)
            }
        }
    }

    async initHistoricalStats() {
         const at = await this.cache.wrap(`${this.name}-historical-allTime`, () => createHistoricalDefaults(), {ttl: 0}) as object;
         const rehydratedAt: any = {};
         for(const [k, v] of Object.entries(at)) {
             const t = typeof v;
             if(t === 'number') {
                 // simple number stat like eventsCheckedTotal
                 rehydratedAt[k] = v;
             } else if(Array.isArray(v)) {
                 // a map stat that we have data for is serialized as an array of KV pairs
                rehydratedAt[k] = new Map(v);
             } else if(v === null || v === undefined || (t === 'object' && Object.keys(v).length === 0)) {
                 // a map stat that was not serialized (for some reason) or serialized without any data
                 rehydratedAt[k] = new Map();
             } else {
                 // ???? shouldn't get here
                 this.logger.warn(`Did not recognize rehydrated historical stat "${k}" of type ${t}`);
                 rehydratedAt[k] = v;
             }
         }
         this.stats.historical.allTime = rehydratedAt as HistoricalStats;
    }

    updateHistoricalStats(data: HistoricalStatUpdateData) {
        for(const [k, v] of Object.entries(data)) {
            if(this.stats.historical.lastReload[k] !== undefined) {
                if(typeof v === 'number') {
                    this.stats.historical.lastReload[k] += v;
                } else if(this.stats.historical.lastReload[k] instanceof Map) {
                    const keys = Array.isArray(v) ? v : [v];
                    for(const key of keys) {
                        this.stats.historical.lastReload[k].set(key, (this.stats.historical.lastReload[k].get(key) || 0) + 1);
                    }
                }
            }
            if(this.stats.historical.allTime[k] !== undefined) {
                if(typeof v === 'number') {
                    this.stats.historical.allTime[k] += v;
                } else if(this.stats.historical.allTime[k] instanceof Map) {
                    const keys = Array.isArray(v) ? v : [v];
                    for(const key of keys) {
                        this.stats.historical.allTime[k].set(key, (this.stats.historical.allTime[k].get(key) || 0) + 1);
                    }
                }
            }
        }
    }

    getHistoricalDisplayStats(): SubredditHistoricalStatsDisplay {
        return {
            allTime: createHistoricalStatsDisplay(this.stats.historical.allTime),
            lastReload: createHistoricalStatsDisplay(this.stats.historical.lastReload)
        }
    }

    async saveHistoricalStats() {
        const atSerializable: any = {};
        for(const [k, v] of Object.entries(this.stats.historical.allTime)) {
            if(v instanceof Map) {
                atSerializable[k] = Array.from(v.entries());
            } else {
                atSerializable[k] = v;
            }
        }
        await this.cache.set(`${this.name}-historical-allTime`, atSerializable, {ttl: 0});

        // const lrSerializable: any = {};
        // for(const [k, v] of Object.entries(this.stats.historical.lastReload)) {
        //     if(v instanceof Map) {
        //         lrSerializable[k] = Array.from(v.entries());
        //     } else {
        //         lrSerializable[k] = v;
        //     }
        // }
        // await this.cache.set(`${this.name}-historical-lastReload`, lrSerializable, {ttl: 0});
    }

    setHistoricalSaveInterval() {
        this.historicalSaveInterval = setInterval((function(self) {
            return async () => {
                await self.saveHistoricalStats();
            }
        })(this),10000);
    }

    async getCacheKeyCount() {
        if (this.cache.store.keys !== undefined) {
            if(this.cacheType === 'redis') {
                const keys = await this.cache.store.keys(`${this.prefix}*`);
                return keys.length;
            }
            return (await this.cache.store.keys()).length;
        }
        return 0;
    }

    async interactWithCacheByKeyPattern(pattern: string | RegExp, action: 'get' | 'delete') {
        let patternIsReg = pattern instanceof RegExp;
        let regPattern: RegExp;
        let globPattern = pattern;

        const cacheDict: Record<string, any> = {};

        if (typeof pattern === 'string') {
            const possibleRegPattern = parseStringToRegex(pattern, 'ig');
            if (possibleRegPattern !== undefined) {
                regPattern = possibleRegPattern;
                patternIsReg = true;
            } else {
                if (this.prefix !== undefined && !pattern.includes(this.prefix)) {
                    // need to add wildcard to beginning of pattern so that the regex will still match a key with a prefix
                    globPattern = `${this.prefix}${pattern}`;
                }
                // @ts-ignore
                const result = globrex(globPattern, {flags: 'i'});
                regPattern = result.regex;
            }
        } else {
            regPattern = pattern;
        }

        if (this.cacheType === 'redis') {
            // @ts-ignore
            const redisClient = this.cache.store.getClient();
            if (patternIsReg) {
                // scan all and test key by regex
                for await (const key of redisClient.scanIterator()) {
                    if (regPattern.test(key) && (this.prefix === undefined || key.includes(this.prefix))) {
                        if (action === 'delete') {
                            await redisClient.del(key)
                        } else {
                            cacheDict[key] = await redisClient.get(key);
                        }
                    }
                }
            } else {
                // not a regex means we can use glob pattern (more efficient!)
                for await (const key of redisScanIterator(redisClient, { MATCH: globPattern })) {
                    if (action === 'delete') {
                        await redisClient.del(key)
                    } else {
                        cacheDict[key] = await redisClient.get(key);
                    }
                }
            }
        } else if (this.cache.store.keys !== undefined) {
            for (const key of await this.cache.store.keys()) {
                if (regPattern.test(key) && (this.prefix === undefined || key.includes(this.prefix))) {
                    if (action === 'delete') {
                        await this.cache.del(key)
                    } else {
                        cacheDict[key] = await this.cache.get(key);
                    }
                }
            }
        }
        return cacheDict;
    }

    async deleteCacheByKeyPattern(pattern: string | RegExp) {
        return await this.interactWithCacheByKeyPattern(pattern, 'delete');
    }

    async getCacheByKeyPattern(pattern: string | RegExp) {
        return await this.interactWithCacheByKeyPattern(pattern, 'get');
    }

    async resetCacheForItem(item: Comment | Submission | RedditUser) {
        if (asActivity(item)) {
            if (this.filterCriteriaTTL !== false) {
                await this.deleteCacheByKeyPattern(`itemCrit-${item.name}*`);
            }
            await this.setActivity(item, false);
        } else if (isUser(item) && this.filterCriteriaTTL !== false) {
            await this.deleteCacheByKeyPattern(`authorCrit-*-${getActivityAuthorName(item)}*`);
        }
    }

    async getStats() {
        const totals = Object.values(this.stats.cache).reduce((acc, curr) => ({
            miss: acc.miss + curr.miss,
            req: acc.req + curr.requests,
        }), {miss: 0, req: 0});
        const cacheKeys = Object.keys(this.stats.cache);
        return {
            cache: {
                // TODO could probably combine these two
                totalRequests: totals.req,
                totalMiss: totals.miss,
                missPercent: `${formatNumber(totals.miss === 0 || totals.req === 0 ? 0 :(totals.miss/totals.req) * 100, {toFixed: 0})}%`,
                types: await cacheKeys.reduce(async (accProm, curr) => {
                    const acc = await accProm;
                    // calculate miss percent

                    const per = acc[curr].miss === 0 ? 0 : formatNumber(acc[curr].miss / acc[curr].requests) * 100;
                    acc[curr].missPercent = `${formatNumber(per, {toFixed: 0})}%`;

                    // calculate average identifier hits

                    const idCache = acc[curr].identifierRequestCount;
                    // @ts-expect-error
                    const idKeys = await idCache.store.keys() as string[];
                    if(idKeys.length > 0) {
                        let hits = 0;
                        for (const k of idKeys) {
                            hits += await idCache.get(k) as number;
                        }
                        acc[curr].identifierAverageHit = formatNumber(hits/idKeys.length);
                    }

                    if(acc[curr].requestTimestamps.length > 1) {
                        // calculate average time between request
                        const diffData = acc[curr].requestTimestamps.reduce((acc, curr: number) => {
                            if(acc.last === 0) {
                                acc.last = curr;
                                return acc;
                            }
                            acc.diffs.push(curr - acc.last);
                            acc.last = curr;
                            return acc;
                        },{last: 0, diffs: [] as number[]});
                        const avgDiff = diffData.diffs.reduce((acc, curr) => acc + curr, 0) / diffData.diffs.length;

                        acc[curr].averageTimeBetweenHits = formatNumber(avgDiff/1000);
                    }

                    return acc;
                }, Promise.resolve(this.stats.cache))
            }
        }
    }

    setLogger(logger: Logger) {
        this.logger = logger.child({labels: ['Resource Cache']}, mergeArr);
    }

    async getActionedEvents(): Promise<ActionedEvent[]> {
        return await this.cache.wrap(`actionedEvents-${this.subreddit.display_name}`, () => []);
    }

    async addActionedEvent(ae: ActionedEvent) {
        const events = await this.cache.wrap(`actionedEvents-${this.subreddit.display_name}`, () => []) as ActionedEvent[];
        events.unshift(ae);
        await this.cache.set(`actionedEvents-${this.subreddit.display_name}`, events.slice(0, this.actionedEventsMax), {ttl: 0});
    }

    async getActivity(item: Submission | Comment) {
        try {
            let hash = '';
            if (this.submissionTTL !== false && asSubmission(item)) {
                hash = `sub-${item.name}`;
                await this.stats.cache.submission.identifierRequestCount.set(hash, (await this.stats.cache.submission.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
                this.stats.cache.submission.requestTimestamps.push(Date.now());
                this.stats.cache.submission.requests++;
                const cachedSubmission = await this.cache.get(hash);
                if (cachedSubmission !== undefined && cachedSubmission !== null) {
                    this.logger.debug(`Cache Hit: Submission ${item.name}`);
                    return cachedSubmission;
                }
                this.stats.cache.submission.miss++;
                return await this.setActivity(item);
            } else if (this.commentTTL !== false) {
                hash = `comm-${item.name}`;
                await this.stats.cache.comment.identifierRequestCount.set(hash, (await this.stats.cache.comment.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
                this.stats.cache.comment.requestTimestamps.push(Date.now());
                this.stats.cache.comment.requests++;
                const cachedComment = await this.cache.get(hash);
                if (cachedComment !== undefined && cachedComment !== null) {
                    this.logger.debug(`Cache Hit: Comment ${item.name}`);
                    return cachedComment;
                }
                this.stats.cache.comment.miss++;
                return this.setActivity(item);
            } else {
                // @ts-ignore
                return await item.fetch();
            }
        } catch (err: any) {
            this.logger.error('Error while trying to fetch a cached activity', err);
            throw err.logged;
        }
    }

    // @ts-ignore
    public async setActivity(item: Submission | Comment, tryToFetch = true)
    {
        let hash = '';
        if(this.submissionTTL !== false && isSubmission(item)) {
            hash = `sub-${item.name}`;
            if(tryToFetch && item instanceof Submission) {
                // @ts-ignore
                const itemToCache = await item.fetch();
                await this.cache.set(hash, itemToCache, {ttl: this.submissionTTL});
                return itemToCache;
            } else {
                // @ts-ignore
                await this.cache.set(hash, item, {ttl: this.submissionTTL});
                return item;
            }
        } else if(this.commentTTL !== false){
            hash = `comm-${item.name}`;
            if(tryToFetch && item instanceof Comment) {
                // @ts-ignore
                const itemToCache = await item.fetch();
                await this.cache.set(hash, itemToCache, {ttl: this.commentTTL});
                return itemToCache;
            } else {
                // @ts-ignore
                await this.cache.set(hash, item, {ttl: this.commentTTL});
                return item;
            }
        }
    }

    async hasActivity(item: Submission | Comment) {
        const hash = asSubmission(item) ? `sub-${item.name}` : `comm-${item.name}`;
        const res = await this.cache.get(hash);
        return res !== undefined && res !== null;
    }

    // @ts-ignore
    async getRecentSelf(item: Submission | Comment): Promise<(Submission | Comment | undefined)> {
        const hash = asSubmission(item) ? `sub-recentSelf-${item.name}` : `comm-recentSelf-${item.name}`;
        const res = await this.cache.get(hash);
        if(res === null) {
            return undefined;
        }
        return res as (Submission | Comment | undefined);
    }

    async setRecentSelf(item: Submission | Comment) {
        if(this.selfTTL !== false) {
            const hash = asSubmission(item) ? `sub-recentSelf-${item.name}` : `comm-recentSelf-${item.name}`;
            // @ts-ignore
            await this.cache.set(hash, item, {ttl: this.selfTTL});
        }
        return;
    }
    /**
    * Returns true if the activity being checked was recently acted on/created by the bot and has not changed since that time
    * */
    async hasRecentSelf(item: Submission | Comment) {
        const recent = await this.getRecentSelf(item) as (Submission | Comment | undefined);
        if (recent !== undefined) {
            return item.num_reports === recent.num_reports;

            // can't really used edited since its only ever updated once with no timestamp
            // if(item.num_reports !== recent.num_reports) {
            //     return false;
            // }
            // if(!asSubmission(item)) {
            //     return item.edited === recent.edited;
            // }
            // return true;
        }
        return false;
    }

    // @ts-ignore
    async getSubreddit(item: Submission | Comment) {
        try {
            let hash = '';
            const subName = getActivitySubredditName(item);
            if (this.subredditTTL !== false) {
                hash = `sub-${subName}`;
                await this.stats.cache.subreddit.identifierRequestCount.set(hash, (await this.stats.cache.subreddit.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
                this.stats.cache.subreddit.requestTimestamps.push(Date.now());
                this.stats.cache.subreddit.requests++;
                const cachedSubreddit = await this.cache.get(hash);
                if (cachedSubreddit !== undefined && cachedSubreddit !== null) {
                    this.logger.debug(`Cache Hit: Subreddit ${subName}`);
                    return new Subreddit(cachedSubreddit, this.client, false);
                }
                // @ts-ignore
                const subreddit = await this.client.getSubreddit(subName).fetch() as Subreddit;
                this.stats.cache.subreddit.miss++;
                // @ts-ignore
                await this.cache.set(hash, subreddit, {ttl: this.subredditTTL});
                // @ts-ignore
                return subreddit as Subreddit;
            } else {
                // @ts-ignore
                let subreddit = await this.client.getSubreddit(subName);

                return subreddit as Subreddit;
            }
        } catch (err: any) {
            this.logger.error('Error while trying to fetch a cached activity', err);
            throw err.logged;
        }
    }

    async getSubredditModerators(rawSubredditVal?: Subreddit | string) {
        const subredditVal = rawSubredditVal ?? this.subreddit;
        const subName = typeof subredditVal === 'string' ? subredditVal : subredditVal.display_name;
        const hash = `sub-${subName}-moderators`;
        if (this.subredditTTL !== false) {
            const cachedSubredditMods = await this.cache.get(hash);
            if (cachedSubredditMods !== undefined && cachedSubredditMods !== null) {
                this.logger.debug(`Cache Hit: Subreddit Moderators ${subName}`);
                return (cachedSubredditMods as string[]).map(x => new RedditUser({name: x}, this.client, false));
            }
        }

        let sub: Subreddit;
        if (typeof subredditVal !== 'string') {
            sub = subredditVal;
        } else {
            sub = this.client.getSubreddit(subredditVal);
        }
        const mods = await sub.getModerators();

        if (this.subredditTTL !== false) {
            // @ts-ignore
            await this.cache.set(hash, mods.map(x => x.name), {ttl: this.subredditTTL});
        }

        return mods;
    }

    async getSubredditContributors(): Promise<RedditUser[]> {
        const subName = this.subreddit.display_name;
        const hash = `sub-${subName}-contributors`;
        if (this.subredditTTL !== false) {
            const cachedSubredditMods = await this.cache.get(hash);
            if (cachedSubredditMods !== undefined && cachedSubredditMods !== null) {
                this.logger.debug(`Cache Hit: Subreddit Contributors ${subName}`);
                return (cachedSubredditMods as string[]).map(x => new RedditUser({name: x}, this.client, false));
            }
        }

        let contributors = await this.subreddit.getContributors();
        while(!contributors.isFinished) {
            contributors = await contributors.fetchMore({amount: 100});
        }

        if (this.subredditTTL !== false) {
            // @ts-ignore
            await this.cache.set(hash, contributors.map(x => x.name), {ttl: this.subredditTTL});
        }

        return contributors.map(x => new RedditUser({name: x.name}, this.client, false));
    }

    async addUserToSubredditContributorsCache(user: RedditUser) {
        const subName = this.subreddit.display_name;
        const hash = `sub-${subName}-contributors`;
        if (this.subredditTTL !== false) {
            const cachedVal = await this.cache.get(hash);
            if (cachedVal !== undefined && cachedVal !== null) {
                const cacheContributors = cachedVal as string[];
                if(!cacheContributors.includes(user.name)) {
                    cacheContributors.push(user.name);
                    await this.cache.set(hash, cacheContributors, {ttl: this.subredditTTL});
                }
            }
        }
    }

    async removeUserFromSubredditContributorsCache(user: RedditUser) {
        const subName = this.subreddit.display_name;
        const hash = `sub-${subName}-contributors`;
        if (this.subredditTTL !== false) {
            const cachedVal = await this.cache.get(hash);
            if (cachedVal !== undefined && cachedVal !== null) {
                const cacheContributors = cachedVal as string[];
                if(cacheContributors.includes(user.name)) {
                    await this.cache.set(hash, cacheContributors.filter(x => x !== user.name), {ttl: this.subredditTTL});
                }
            }
        }
    }

    async hasSubreddit(name: string) {
        if (this.subredditTTL !== false) {
            const hash = `sub-${name}`;
            this.stats.cache.subreddit.requests++
            this.stats.cache.subreddit.requestTimestamps.push(Date.now());
            await this.stats.cache.subreddit.identifierRequestCount.set(hash, (await this.stats.cache.subreddit.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
            const val = await this.cache.get(hash);
            if(val === undefined || val === null) {
                this.stats.cache.subreddit.miss++;
            }
            return val !== undefined && val !== null;
        }
        return false;
    }

    // @ts-ignore
    async getAuthor(val: RedditUser | string) {
        const authorName = typeof val === 'string' ? val : val.name;
        const hash = `author-${authorName}`;
        if (this.authorTTL !== false) {
            const cachedAuthorData = await this.cache.get(hash);
            if (cachedAuthorData !== undefined && cachedAuthorData !== null) {
                this.logger.debug(`Cache Hit: Author ${authorName}`);
                const {subreddit, ...rest} = cachedAuthorData as any;
                const snoowrapConformedData = {...rest};
                if(subreddit !== null) {
                    snoowrapConformedData.subreddit = {
                        display_name: subreddit
                    };
                } else {
                    snoowrapConformedData.subreddit = null;
                }
                return new RedditUser(snoowrapConformedData, this.client, true);
            }
        }

        let user: RedditUser;
        if (typeof val !== 'string') {
            user = val;
        } else {
            user = this.client.getUser(val);
        }
        // @ts-ignore
        user = await user.fetch();

        if (this.authorTTL !== false) {
            // @ts-ignore
            await this.cache.set(hash, user, {ttl: this.authorTTL});
        }

        return user;
    }

    async getAuthorActivities(user: RedditUser, options: AuthorTypedActivitiesOptions): Promise<Array<Submission | Comment>> {
        const userName = getActivityAuthorName(user);
        if (this.authorTTL !== false) {
            const hashObj: any = options;
            if (this.useSubredditAuthorCache) {
                hashObj.subreddit = this.subreddit;
            }
            const hash = `authorActivities-${userName}-${options.type || 'overview'}-${objectHash.sha1(hashObj)}`;

            this.stats.cache.author.requests++;
            await this.stats.cache.author.identifierRequestCount.set(userName, (await this.stats.cache.author.identifierRequestCount.wrap(userName, () => 0) as number) + 1);
            this.stats.cache.author.requestTimestamps.push(Date.now());
            let miss = false;
            const cacheVal = await this.cache.wrap(hash, async () => {
                miss = true;
                if(typeof user === 'string') {
                    // @ts-ignore
                    user = await this.client.getUser(userName);
                }
                return await getAuthorActivities(user, options);
            }, {ttl: this.authorTTL});
            if (!miss) {
                this.logger.debug(`Cache Hit: ${userName} (Hash ${hash})`);
            } else {
                this.stats.cache.author.miss++;
            }
            return cacheVal as Array<Submission | Comment>;
        }
        if(typeof user === 'string') {
            // @ts-ignore
            user = await this.client.getUser(userName);
        }
        return await getAuthorActivities(user, options);
    }

    async getAuthorComments(user: RedditUser, options: AuthorActivitiesOptions): Promise<Comment[]> {
        return await this.getAuthorActivities(user, {...options, type: 'comment'}) as unknown as Promise<Comment[]>;
    }

    async getAuthorSubmissions(user: RedditUser, options: AuthorActivitiesOptions): Promise<Submission[]> {
        return await this.getAuthorActivities(user, {
            ...options,
            type: 'submission'
        }) as unknown as Promise<Submission[]>;
    }

    async getContent(val: string, subredditArg?: Subreddit): Promise<string> {
        const subreddit = subredditArg || this.subreddit;
        let cacheKey;
        const wikiContext = parseWikiContext(val);
        if (wikiContext !== undefined) {
            cacheKey = `${wikiContext.wiki}${wikiContext.subreddit !== undefined ? `|${wikiContext.subreddit}` : ''}`;
        }
        const extUrl = wikiContext === undefined ? parseExternalUrl(val) : undefined;
        if (extUrl !== undefined) {
            cacheKey = extUrl;
        }

        if (cacheKey === undefined) {
            return val;
        }

        // try to get cached value first
        let hash = `${subreddit.display_name}-content-${cacheKey}`;
        if (this.wikiTTL !== false) {
            await this.stats.cache.content.identifierRequestCount.set(cacheKey, (await this.stats.cache.content.identifierRequestCount.wrap(cacheKey, () => 0) as number) + 1);
            this.stats.cache.content.requestTimestamps.push(Date.now());
            this.stats.cache.content.requests++;
            const cachedContent = await this.cache.get(hash);
            if (cachedContent !== undefined && cachedContent !== null) {
                this.logger.debug(`Content Cache Hit: ${cacheKey}`);
                return cachedContent as string;
            } else {
                this.stats.cache.content.miss++;
            }
        }

        let wikiContent: string;

        // no cache hit, get from source
        if (wikiContext !== undefined) {
            let sub;
            if (wikiContext.subreddit === undefined || wikiContext.subreddit.toLowerCase() === subreddit.display_name) {
                sub = subreddit;
            } else {
                sub = this.client.getSubreddit(wikiContext.subreddit);
            }
            try {
                // @ts-ignore
                const wikiPage = sub.getWikiPage(wikiContext.wiki);
                wikiContent = await wikiPage.content_md;
            } catch (err: any) {
                let msg = `Could not read wiki page for an unknown reason. Please ensure the page 'https://reddit.com${sub.display_name_prefixed}/wiki/${wikiContext.wiki}' exists and is readable`;
                if(err.statusCode !== undefined) {
                    if(err.statusCode === 404) {
                        msg = `Could not find a wiki page at https://reddit.com${sub.display_name_prefixed}/wiki/${wikiContext.wiki} -- Reddit returned a 404`;
                    } else if(err.statusCode === 403 || err.statusCode === 401) {
                        msg = `Bot either does not have permission visibility permissions for the wiki page at https://reddit.com${sub.display_name_prefixed}wiki/${wikiContext.wiki} (due to subreddit restrictions) or the bot does have have oauth permissions to read wiki pages (operator error). Reddit returned a ${err.statusCode}`;
                    }
                }
                this.logger.error(msg, err);
                throw new LoggedError(msg);
            }
        } else {
            try {
                wikiContent = await fetchExternalUrl(extUrl as string, this.logger);
            } catch (err: any) {
                const msg = `Error occurred while trying to fetch the url ${extUrl}`;
                this.logger.error(msg, err);
                throw new LoggedError(msg);
            }
        }

        if (this.wikiTTL !== false) {
            this.cache.set(hash, wikiContent, {ttl: this.wikiTTL});
        }

        return wikiContent;
    }

    async cacheSubreddits(subs: (Subreddit | string)[]) {
        const allSubs = subs.map(x => typeof x !== 'string' ? x.display_name : x);
        const subNames = [...new Set(allSubs)];
        const uncachedSubs = [];

        for(const s of subNames) {
            if(!(await this.hasSubreddit(s))) {
                uncachedSubs.push(s);
            }
        }
        if(uncachedSubs.length > 0) {
            // cache all uncached subs batchly-like
            const subResults = await this.client.getManySubreddits(uncachedSubs);
            for(const s of subResults) {
                // @ts-ignore
                await this.cache.set(`sub-${s.display_name}`, s, {ttl: this.subredditTTL});
            }
        }
    }

    async batchTestSubredditCriteria(items: (Comment | Submission)[], states: (SubredditState | StrongSubredditState)[], author: RedditUser): Promise<(Comment | Submission)[]> {
        let passedItems: (Comment | Submission)[] = [];
        let unpassedItems: (Comment | Submission)[] = [];

        const {nameOnly =  [], full = []} = states.reduce((acc: {nameOnly: (SubredditState | StrongSubredditState)[], full: (SubredditState | StrongSubredditState)[]}, curr) => {
            if(subredditStateIsNameOnly(curr)) {
                return {...acc, nameOnly: acc.nameOnly.concat(curr)};
            }
            return {...acc, full: acc.full.concat(curr)};
        }, {nameOnly: [], full: []});

        if(nameOnly.length === 0) {
            unpassedItems = items;
        } else {
            for(const item of items) {
                const subName = getActivitySubredditName(item);
                for(const state of nameOnly) {
                    if(await this.isSubreddit({display_name: subName} as Subreddit, state, author, this.logger)) {
                        passedItems.push(item);
                        break;
                    }
                }
                unpassedItems.push(item);
            }
        }

        if(unpassedItems.length > 0 && full.length > 0) {
            await this.cacheSubreddits(unpassedItems.map(x => x.subreddit));
            for(const item of unpassedItems) {
                for(const state of full) {
                    if(await this.isSubreddit(await this.getSubreddit(item), state, author, this.logger)) {
                        passedItems.push(item);
                        break;
                    }
                }
            }
        }

        return passedItems;
    }

    async testSubredditCriteria(item: (Comment | Submission), state: SubredditState | StrongSubredditState, author: RedditUser) {
        if(Object.keys(state).length === 0) {
            return true;
        }
        // optimize for name-only criteria checks
        // -- we don't need to store cache results for this since we know subreddit name is always available from item (no request required)
        const critCount = Object.entries(state).filter(([key, val]) => {
            return val !== undefined && !['name','stateDescription'].includes(key);
        }).length;
        if(critCount === 0) {
            const subName = getActivitySubredditName(item);
            return await this.isSubreddit({display_name: subName} as Subreddit, state, author, this.logger);
        }

        // see comments on shouldCacheSubredditStateCriteriaResult() for why this is needed
        if (this.filterCriteriaTTL !== false && shouldCacheSubredditStateCriteriaResult(state)) {
            try {
                const hash = `subredditCrit-${getActivitySubredditName(item)}-${objectHash.sha1(state)}`;
                await this.stats.cache.subredditCrit.identifierRequestCount.set(hash, (await this.stats.cache.subredditCrit.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
                this.stats.cache.subredditCrit.requestTimestamps.push(Date.now());
                this.stats.cache.subredditCrit.requests++;
                const cachedItem = await this.cache.get(hash);
                if (cachedItem !== undefined && cachedItem !== null) {
                    this.logger.debug(`Cache Hit: Subreddit Check on ${getActivitySubredditName(item)} (Hash ${hash})`);
                    return cachedItem as boolean;
                }
                const itemResult = await this.isSubreddit(await this.getSubreddit(item), state, author, this.logger);
                this.stats.cache.subredditCrit.miss++;
                await this.cache.set(hash, itemResult, {ttl: this.filterCriteriaTTL});
                return itemResult;
            } catch (err: any) {
                if (err.logged !== true) {
                    this.logger.error('Error occurred while testing subreddit criteria', err);
                }
                throw err;
            }
        }

        return await this.isSubreddit(await this.getSubreddit(item), state, author, this.logger);
    }

    async testAuthorCriteria(item: (Comment | Submission), authorOpts: AuthorCriteria, include = true): Promise<FilterCriteriaResult<AuthorCriteria>> {
        if (this.filterCriteriaTTL !== false) {
            // in the criteria check we only actually use the `item` to get the author flair
            // which will be the same for the entire subreddit
            //
            // so we can create a hash only using subreddit-author-criteria
            // and ignore the actual item
            const hashObj = {...authorOpts, include};
            const userName = getActivityAuthorName(item.author);
            const hash = `authorCrit-${this.subreddit.display_name}-${userName}-${objectHash.sha1(hashObj)}`;
            await this.stats.cache.authorCrit.identifierRequestCount.set(hash, (await this.stats.cache.authorCrit.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
            this.stats.cache.authorCrit.requestTimestamps.push(Date.now());
            this.stats.cache.authorCrit.requests++;

            // need to check shape of result to invalidate old result type
            let cachedAuthorTest: FilterCriteriaResult<AuthorCriteria> = await this.cache.get(hash) as FilterCriteriaResult<AuthorCriteria>;
            if(cachedAuthorTest !== null && cachedAuthorTest !== undefined && typeof cachedAuthorTest === 'object') {
                this.logger.debug(`Cache Hit: Author Check on ${userName} (Hash ${hash})`);
                return cachedAuthorTest;
            } else {
                this.stats.cache.authorCrit.miss++;
                cachedAuthorTest = await this.isAuthor(item, authorOpts, include);
                await this.cache.set(hash, cachedAuthorTest, {ttl: this.filterCriteriaTTL});
                return cachedAuthorTest;
            }
        }

        return await this.isAuthor(item, authorOpts, include);
    }

    async testItemCriteria(i: (Comment | Submission), activityState: TypedActivityState, logger: Logger, source?: ActivitySource): Promise<FilterCriteriaResult<TypedActivityState>> {
        if(Object.keys(activityState).length === 0) {
            return {
                behavior: 'include',
                criteria: activityState,
                propertyResults: [],
                passed: true
            }
        }
        if (this.filterCriteriaTTL !== false) {
            let item = i;
            const {dispatched, source: stateSource, ...rest} = activityState;
            let state = rest;

            // if using cache and dispatched is present we want to test for it separately from the rest of the state
            // because it can change independently from the rest of the activity criteria (its only related to CM!) so storing in cache would make everything potentially stale
            // -- additionally we keep that data in-memory (for now??) so its always accessible and doesn't need to be stored in cache
            let runtimeRes: FilterCriteriaResult<(SubmissionState & CommentState)> | undefined;
            if(dispatched !== undefined || stateSource !== undefined) {
                runtimeRes = await this.isItem(item, {dispatched, source: stateSource}, logger, source);
                if(!runtimeRes.passed) {
                    // if dispatched does not pass can return early and avoid testing the rest of the item
                    const [propResultsMap, definedStateCriteria] = generateItemFilterHelpers(rest);
                    if(dispatched !== undefined) {
                        propResultsMap.dispatched = runtimeRes.propertyResults.find(x => x.property === 'dispatched');
                    }
                    if(stateSource !== undefined) {
                        propResultsMap.source = runtimeRes.propertyResults.find(x => x.property === 'source');
                    }

                    return {
                        behavior: 'include',
                        criteria: activityState,
                        propertyResults: Object.values(propResultsMap),
                        passed: false
                    }
                }
            }

            try {
                // only cache non-runtime state and results
                const hash = `itemCrit-${item.name}-${objectHash.sha1(state)}`;
                await this.stats.cache.itemCrit.identifierRequestCount.set(hash, (await this.stats.cache.itemCrit.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
                this.stats.cache.itemCrit.requestTimestamps.push(Date.now());
                this.stats.cache.itemCrit.requests++;
                let itemResult = await this.cache.get(hash) as FilterCriteriaResult<TypedActivityState> | undefined | null;
                if (itemResult !== undefined && itemResult !== null) {
                    this.logger.debug(`Cache Hit: Item Check on ${item.name} (Hash ${hash})`);
                    //return cachedItem as boolean;
                } else {
                    itemResult = await this.isItem(item, state, logger);
                }
                this.stats.cache.itemCrit.miss++;
                await this.cache.set(hash, itemResult, {ttl: this.filterCriteriaTTL});

                // add in runtime results, if present
                if(runtimeRes !== undefined) {
                    if(dispatched !== undefined) {
                        itemResult.propertyResults.push(runtimeRes.propertyResults.find(x => x.property === 'dispatched') as FilterCriteriaPropertyResult<TypedActivityState>);
                    }
                    if(stateSource !== undefined) {
                        itemResult.propertyResults.push(runtimeRes.propertyResults.find(x => x.property === 'source') as FilterCriteriaPropertyResult<TypedActivityState>);
                    }
                }

                return itemResult;
            } catch (err: any) {
                if (err.logged !== true) {
                    this.logger.error('Error occurred while testing item criteria', err);
                }
                throw err;
            }
        }

        return await this.isItem(i, activityState, logger, source);
    }

    async isSubreddit (subreddit: Subreddit, stateCriteriaRaw: SubredditState | StrongSubredditState, author: RedditUser, logger: Logger) {
        const {stateDescription, ...stateCriteria} = stateCriteriaRaw;

        let fetchedUser: RedditUser | undefined;
        // @ts-ignore
        const user = async (): Promise<RedditUser> => {
            if(fetchedUser === undefined) {
                fetchedUser = await this.getAuthor(author);
            }
            // @ts-ignore
            return fetchedUser;
        }

        if (Object.keys(stateCriteria).length === 0) {
            return true;
        }

        const crit = isStrongSubredditState(stateCriteria) ? stateCriteria : toStrongSubredditState(stateCriteria, {defaultFlags: 'i'});

        const log = logger.child({leaf: 'Subreddit Check'}, mergeArr);

        return await (async () => {
            for (const k of Object.keys(crit)) {
                // @ts-ignore
                if (crit[k] !== undefined) {
                    switch (k) {
                        case 'name':
                            const nameReg = crit[k] as RegExp;
                            if(!nameReg.test(subreddit.display_name)) {
                                return false;
                            }
                            break;
                        case 'isUserProfile':
                            const entity = parseRedditEntity(subreddit.display_name);
                            const entityIsUserProfile = entity.type === 'user';
                            if(crit[k] !== entityIsUserProfile) {
                                // @ts-ignore
                                log.debug(`Failed: Expected => ${k}:${crit[k]} | Found => ${k}:${entityIsUserProfile}`)
                                return false
                            }
                            break;
                        case 'over18':
                        case 'over_18':
                            // handling an edge case where user may have confused Comment/Submission state "over_18" with SubredditState "over18"

                            // @ts-ignore
                            if (crit[k] !== subreddit.over18) {
                                // @ts-ignore
                                log.debug(`Failed: Expected => ${k}:${crit[k]} | Found => ${k}:${subreddit.over18}`)
                                return false
                            }
                            break;
                        case 'isOwnProfile':
                            // @ts-ignore
                            const ownSub = (await user()).subreddit?.display_name.display_name;
                            const isOwn = subreddit.display_name === ownSub
                            // @ts-ignore
                            if (crit[k] !== isOwn) {
                                // @ts-ignore
                                log.debug(`Failed: Expected => ${k}:${crit[k]} | Found => ${k}:${isOwn}`)
                                return false
                            }
                            break;
                        default:
                            // @ts-ignore
                            if (subreddit[k] !== undefined) {
                                // @ts-ignore
                                if (crit[k] !== subreddit[k]) {
                                    // @ts-ignore
                                    log.debug(`Failed: Expected => ${k}:${crit[k]} | Found => ${k}:${subreddit[k]}`)
                                    return false
                                }
                            } else {
                                log.warn(`Tried to test for Subreddit property '${k}' but it did not exist`);
                            }
                            break;
                    }
                }
            }
            log.debug(`Passed: ${JSON.stringify(stateCriteria)}`);
            return true;
        })() as boolean;
    }

    async isItem (item: Submission | Comment, stateCriteria: TypedActivityState, logger: Logger, source?: ActivitySource): Promise<FilterCriteriaResult<(SubmissionState & CommentState)>> {

        //const definedStateCriteria = (removeUndefinedKeys(stateCriteria) as RequiredItemCrit);

        const [propResultsMap, definedStateCriteria] = generateItemFilterHelpers(stateCriteria);

        const log = logger.child({leaf: 'Item Check'}, mergeArr);

        if(Object.keys(stateCriteria).length === 0) {
            return {
                behavior: 'include',
                criteria: stateCriteria,
                propertyResults: [],
                passed: true
            }
        }

        // const propResultsMap = Object.entries(definedStateCriteria).reduce((acc: ItemCritPropHelper, [k, v]) => {
        //     const key = (k as keyof (SubmissionState & CommentState));
        //     acc[key] = {
        //         property: key,
        //         behavior: 'include',
        //     };
        //     return acc;
        // }, {});

        const keys = Object.keys(propResultsMap) as (keyof (SubmissionState & CommentState))[]

        try {
            for(const k of keys) {
                const itemOptVal = definedStateCriteria[k];

                switch(k) {
                    case 'submissionState':
                        if(isSubmission(item)) {
                            const subMsg = `'submissionState' is not allowed in 'itemIs' criteria when the main Activity is a Submission`;
                            log.warn(subMsg);
                            propResultsMap.submissionState!.passed = true;
                            propResultsMap.submissionState!.reason = subMsg;
                            break;
                        }
                    //     // get submission
                    //     // @ts-ignore
                    //     const subProxy = await this.client.getSubmission(await item.link_id);
                    //     // @ts-ignore
                    //     const sub = await this.getActivity(subProxy);
                    //
                    //     const subStates = itemOptVal as RequiredItemCrit['submissionState'];
                    //     // @ts-ignore
                    //     const subResults = [];
                    //     for(const subState of subStates) {
                    //         subResults.push(await this.testItemCriteria(sub, subState as SubmissionState, logger))
                    //     }
                    //     propResultsMap.submissionState!.passed = subResults.length === 0 || subResults.some(x => x.passed);
                    //     propResultsMap.submissionState!.found = {
                    //         join: 'OR',
                    //         criteriaResults: subResults,
                    //         passed: propResultsMap.submissionState!.passed
                    //     };
                         break;
                    case 'dispatched':
                        const matchingDelayedActivities = this.delayedItems.filter(x => x.activity.name === item.name);
                        let found: string | boolean = matchingDelayedActivities.length > 0;
                        let reason: string | undefined;
                        let identifiers: string[] | undefined;
                        if(found && typeof itemOptVal !== 'boolean') {
                            identifiers = Array.isArray(itemOptVal) ? (itemOptVal as string[]) : [itemOptVal as string];
                            for(const i of identifiers) {
                                const matchingDelayedIdentifier = matchingDelayedActivities.find(x => x.identifier === i);
                                if(matchingDelayedIdentifier !== undefined) {
                                    found = matchingDelayedIdentifier.identifier as string;
                                    break;
                                }
                            }
                            if(found === true) {
                                reason = 'Found delayed activities but none matched dispatch identifier';
                            }
                        }
                        propResultsMap.dispatched!.passed = found === itemOptVal || typeof found === 'string';
                        propResultsMap.dispatched!.found = found;
                        propResultsMap.dispatched!.reason = reason;
                        break;
                    case 'source':
                        if(source === undefined) {
                            propResultsMap.source!.passed = false;
                            propResultsMap.source!.found = 'Not From Source';
                            propResultsMap.source!.reason = 'Activity was not retrieved from a source (may be from cache)';
                            break;
                        } else {
                            propResultsMap.source!.found = source;

                            const requestedSourcesVal: string[] = !Array.isArray(itemOptVal) ? [itemOptVal] as string[] : itemOptVal as string[];
                            const requestedSources = requestedSourcesVal.map(x => strToActivitySource(x).toLowerCase());

                            propResultsMap.source!.passed = requestedSources.some(x => source.toLowerCase().includes(x))
                            break;
                        }
                    case 'score':
                        const scoreCompare = parseGenericValueComparison(itemOptVal as string);
                        propResultsMap.score!.passed = comparisonTextOp(item.score, scoreCompare.operator, scoreCompare.value);
                        propResultsMap.score!.found = item.score;
                        break;
                    case 'reports':
                        if (!item.can_mod_post) {
                            const reportsMsg = 'Cannot test for reports on Activity in a subreddit bot account is not a moderator of. Skipping criteria...';
                            log.debug(reportsMsg);
                            propResultsMap.reports!.passed = true;
                            propResultsMap.reports!.reason = reportsMsg;
                            break;
                        }
                        const reportCompare = parseGenericValueComparison(itemOptVal as string);
                        let reportType = 'total';
                        if(reportCompare.extra !== undefined && reportCompare.extra.trim() !== '') {
                            const requestedType = reportCompare.extra.toLocaleLowerCase().trim();
                            if(requestedType.includes('mod')) {
                                reportType = 'mod';
                            } else if(requestedType.includes('user')) {
                                reportType = 'user';
                            } else {
                                const reportTypeWarn = `Did not recognize the report type "${requestedType}" -- can only use "mod" or "user". Will default to TOTAL reports`;
                                log.debug(reportTypeWarn);
                                propResultsMap.reports!.reason = reportTypeWarn;
                            }
                        }
                        let reportNum = item.num_reports;
                        if(reportType === 'user') {
                            reportNum = item.user_reports.length;
                        } else {
                            reportNum = item.mod_reports.length;
                        }
                        propResultsMap.reports!.found = `${reportNum} ${reportType}`;
                        propResultsMap.reports!.passed = comparisonTextOp(reportNum, reportCompare.operator, reportCompare.value);
                        break;
                    case 'removed':

                        const removed = activityIsRemoved(item);

                        if(typeof itemOptVal === 'boolean') {
                            propResultsMap.removed!.passed = removed === itemOptVal;
                            propResultsMap.removed!.found = removed;
                        } else if(!removed) {
                            propResultsMap.removed!.passed = false;
                            propResultsMap.removed!.found = 'Not Removed';
                        } else {
                            if(!item.can_mod_post || (item.banned_by === null || item.banned_by === undefined)) {
                                propResultsMap.removed!.passed = false;
                                propResultsMap.removed!.found = 'No moderator access';
                                propResultsMap.removed!.reason = 'Could not determine who removed Activity b/c Bot is a not a moderator in the Activity\'s subreddit';
                            } else {
                                propResultsMap.removed!.found = `Removed by u/${item.banned_by.name}`;

                                // TODO move normalization into normalizeCriteria after merging databaseSupport into edge
                                let behavior: 'include' | 'exclude' = 'include';
                                let names: string[] = [];
                                if(typeof itemOptVal === 'string') {
                                    names.push(itemOptVal);
                                } else if(Array.isArray(itemOptVal)) {
                                    names = itemOptVal as string[];
                                } else {
                                    const {
                                        behavior: rBehavior = 'include',
                                        name
                                    } = itemOptVal as ModeratorNameCriteria;
                                    behavior = rBehavior;
                                    if(typeof name === 'string') {
                                        names.push(name);
                                    } else {
                                        names = name;
                                    }
                                }
                                names = [...new Set(names.map(x => {
                                    const clean = x.trim();
                                    if(x.toLocaleLowerCase() === 'self' && this.botAccount !== undefined) {
                                        return this.botAccount.toLocaleLowerCase();
                                    }
                                    if(x.toLocaleLowerCase() === 'automod') {
                                        return 'automoderator';
                                    }
                                    return clean;
                                }))]
                                const removedBy = item.banned_by.name.toLocaleLowerCase();
                                if(behavior === 'include') {
                                    propResultsMap.removed!.passed = names.some(x => x.toLocaleLowerCase().includes(removedBy));
                                } else {
                                    propResultsMap.removed!.passed = !names.some(x => x.toLocaleLowerCase().includes(removedBy));
                                }
                            }
                        }
                        break;
                    case 'deleted':
                        const deleted = activityIsDeleted(item);
                        propResultsMap.deleted!.passed = deleted === itemOptVal;
                        propResultsMap.deleted!.found = deleted;
                        break;
                    case 'filtered':
                        if (!item.can_mod_post) {
                            const filteredWarn =`Cannot test for 'filtered' state on Activity in a subreddit bot account is not a moderator for. Skipping criteria...`;
                            log.debug(filteredWarn);
                            propResultsMap.filtered!.passed = true;
                            propResultsMap.filtered!.reason = filteredWarn;
                            break;
                        }
                        const filtered = activityIsFiltered(item);
                        propResultsMap.filtered!.passed = filtered === itemOptVal;
                        propResultsMap.filtered!.found = filtered;
                        break;
                    case 'age':
                        const created = dayjs.unix(await item.created);
                        const ageTest = compareDurationValue(parseDurationComparison(itemOptVal as string), created);
                        propResultsMap.age!.passed = ageTest;
                        propResultsMap.age!.found = created.format('MMMM D, YYYY h:mm A Z');
                        break;
                    case 'title':
                        if((item instanceof Comment)) {
                            const titleWarn ='`title` is not allowed in `itemIs` criteria when the main Activity is a Comment';
                            log.debug(titleWarn);
                            propResultsMap.title!.passed = true;
                            propResultsMap.title!.reason = titleWarn;
                            break;
                        }

                        propResultsMap.title!.found = item.title;

                        try {
                            const [titlePass, reg] = testMaybeStringRegex(itemOptVal as string, item.title);
                            propResultsMap.title!.passed = titlePass;
                        } catch (err: any) {
                            propResultsMap.title!.passed = false;
                            propResultsMap.title!.reason = err.message;
                        }
                        break;
                    case 'isRedditMediaDomain':
                        if((item instanceof Comment)) {
                            const mediaWarn = '`isRedditMediaDomain` is not allowed in `itemIs` criteria when the main Activity is a Comment';
                            log.debug(mediaWarn);
                            propResultsMap.isRedditMediaDomain!.passed = true;
                            propResultsMap.isRedditMediaDomain!.reason = mediaWarn;
                            break;
                        }

                        propResultsMap.isRedditMediaDomain!.found = item.is_reddit_media_domain;
                        propResultsMap.isRedditMediaDomain!.passed = item.is_reddit_media_domain === itemOptVal;
                        break;
                    case 'approved':
                        if(!item.can_mod_post) {
                            const spamWarn = `Cannot test for '${k}' state on Activity in a subreddit bot account is not a moderator for. Skipping criteria...`
                            log.debug(spamWarn);
                            propResultsMap[k]!.passed = true;
                            propResultsMap[k]!.reason = spamWarn;
                            break;
                        }

                        if(typeof itemOptVal === 'boolean') {
                            // @ts-ignore
                            propResultsMap.approved!.found = item[k];
                            propResultsMap.approved!.passed = propResultsMap[k]!.found === itemOptVal;
                            // @ts-ignore
                        } else if(!item.approved) {
                            propResultsMap.removed!.passed = false;
                            propResultsMap.removed!.found = 'Not Approved';
                        } else {
                            if(!item.can_mod_post || (item.approved_by === null || item.approved_by === undefined)) {
                                propResultsMap.approved!.passed = false;
                                propResultsMap.approved!.found = 'No moderator access';
                                propResultsMap.approved!.reason = 'Could not determine who approved Activity b/c Bot is a not a moderator in the Activity\'s subreddit';
                            } else {
                                propResultsMap.approved!.found = `Approved by u/${item.approved_by.name}`;

                                // TODO move normalization into normalizeCriteria after merging databaseSupport into edge
                                let behavior: 'include' | 'exclude' = 'include';
                                let names: string[] = [];
                                if(typeof itemOptVal === 'string') {
                                    names.push(itemOptVal);
                                } else if(Array.isArray(itemOptVal)) {
                                    names = itemOptVal as string[];
                                } else {
                                    const {
                                        behavior: rBehavior = 'include',
                                        name
                                    } = itemOptVal as ModeratorNameCriteria;
                                    behavior = rBehavior;
                                    if(typeof name === 'string') {
                                        names.push(name);
                                    } else {
                                        names = name;
                                    }
                                }
                                names = [...new Set(names.map(x => {
                                    const clean = x.trim();
                                    if(x.toLocaleLowerCase() === 'self' && this.botAccount !== undefined) {
                                        return this.botAccount.toLocaleLowerCase();
                                    }
                                    if(x.toLocaleLowerCase() === 'automod') {
                                        return 'automoderator';
                                    }
                                    return clean;
                                }))]
                                const doneBy = item.approved_by.name.toLocaleLowerCase();
                                if(behavior === 'include') {
                                    propResultsMap.approved!.passed = names.some(x => x.toLocaleLowerCase().includes(doneBy));
                                } else {
                                    propResultsMap.approved!.passed = !names.some(x => x.toLocaleLowerCase().includes(doneBy));
                                }
                            }
                        }
                        break;
                    case 'spam':
                        if(!item.can_mod_post) {
                            const spamWarn = `Cannot test for '${k}' state on Activity in a subreddit bot account is not a moderator for. Skipping criteria...`
                            log.debug(spamWarn);
                            propResultsMap[k]!.passed = true;
                            propResultsMap[k]!.reason = spamWarn;
                            break;
                        }
                        // @ts-ignore
                        propResultsMap[k]!.found = item[k];
                        propResultsMap[k]!.passed = propResultsMap[k]!.found === itemOptVal;
                        break;
                    case 'op':
                        if(isSubmission(item)) {
                            const opWarn = `On a Submission the 'op' property will always be true. Did you mean to use this on a comment instead?`;
                            log.debug(opWarn);
                            propResultsMap.op!.passed = true;
                            propResultsMap.op!.reason = opWarn;
                            break;
                        }
                        propResultsMap.op!.found = (item as Comment).is_submitter;
                        propResultsMap.op!.passed = propResultsMap.op!.found === itemOptVal;
                        break;
                    case 'depth':
                        if(isSubmission(item)) {
                            const depthWarn = `Cannot test for 'depth' on a Submission`;
                            log.debug(depthWarn);
                            propResultsMap.depth!.passed = true;
                            propResultsMap.depth!.reason = depthWarn;
                            break;
                        }
                        const depthCompare = parseGenericValueComparison(itemOptVal as string);

                        const depth = (item as Comment).depth;
                        propResultsMap.depth!.found = depth;
                        propResultsMap.depth!.passed = comparisonTextOp(depth, depthCompare.operator, depthCompare.value);
                        break;
                    case 'flairTemplate':
                    case 'link_flair_text':
                    case 'link_flair_css_class':
                        if(asSubmission(item)) {
                            let propertyValue: string | null;
                            if(k === 'flairTemplate') {
                                propertyValue = await item.link_flair_template_id;
                            } else {
                                propertyValue = await item[k];
                            }

                            propResultsMap[k]!.found = propertyValue;

                            if (typeof itemOptVal === 'boolean') {
                                if (itemOptVal === true) {
                                    propResultsMap[k]!.passed = propertyValue !== undefined && propertyValue !== null && propertyValue !== '';
                                } else {
                                    propResultsMap[k]!.passed = propertyValue === undefined || propertyValue === null || propertyValue === '';
                                }
                            } else if (propertyValue === undefined || propertyValue === null || propertyValue === '') {
                                // if crit is not a boolean but property is "empty" then it'll never pass anyway
                                propResultsMap[k]!.passed = false;
                            } else {
                                const expectedValues = typeof itemOptVal === 'string' ? [itemOptVal] : (itemOptVal as string[]);
                                propResultsMap[k]!.passed = expectedValues.some(x => x.trim().toLowerCase() === propertyValue?.trim().toLowerCase());
                            }
                            break;
                        } else {
                            propResultsMap[k]!.passed = true;
                            propResultsMap[k]!.reason = `Cannot test for ${k} on Comment`;
                            log.warn(`Cannot test for ${k} on Comment`);
                            break;
                        }
                    default:

                        // @ts-ignore
                        const val = item[k];

                        // this shouldn't happen
                        if(propResultsMap[k] === undefined) {
                            log.warn(`State criteria property ${k} was not found in property map?? This shouldn't happen`);
                        } else if(val === undefined) {

                            let defaultWarn = `Tried to test for Activity property '${k}' but it did not exist. Check the spelling of the property.`;
                            if(!item.can_mod_post) {
                                defaultWarn =`Tried to test for Activity property '${k}' but it did not exist. This Activity is not in a subreddit the bot can mod so it may be that this property is only available to mods of that subreddit. Or the property may be misspelled.`;
                            }
                            log.debug(defaultWarn);
                            propResultsMap[k]!.found = 'undefined';
                            propResultsMap[k]!.reason = defaultWarn;

                        } else {
                            propResultsMap[k]!.found = val;
                            propResultsMap[k]!.passed = val === itemOptVal;
                        }
                        break;
                }

                if(propResultsMap[k] !== undefined && propResultsMap[k]!.passed === false) {
                    break;
                }
            }
        } catch (err: any) {
            throw new ErrorWithCause('Could not execute Item Filter on Activity due to an expected error', {cause: err});
        }

        // gather values and determine overall passed
        const propResults = Object.values(propResultsMap);
        const passed = propResults.filter(x => typeof x.passed === 'boolean').every(x => x.passed === true);

        return {
            behavior: 'include',
            criteria: stateCriteria,
            propertyResults: propResults,
            passed,
        };
    }

    async isAuthor(item: (Comment | Submission), authorOpts: AuthorCriteria, include = true): Promise<FilterCriteriaResult<AuthorCriteria>> {
        const definedAuthorOpts = (removeUndefinedKeys(authorOpts) as RequiredAuthorCrit);

        let fetchedUser: RedditUser | undefined;
        // @ts-ignore
        const user = async (): Promise<RedditUser> => {
            if(fetchedUser === undefined) {
                fetchedUser = await this.getAuthor(item.author);
            }
            // @ts-ignore
            return fetchedUser;
        }

        const propResultsMap = Object.entries(definedAuthorOpts).reduce((acc: AuthorCritPropHelper, [k, v]) => {
            const key = (k as keyof AuthorCriteria);
            let ex;
            if (Array.isArray(v)) {
                ex = v.map(x => {
                    if (asUserNoteCriteria(x)) {
                        return userNoteCriteriaSummary(x);
                    }
                    return x;
                });
            } else {
                ex = [v];
            }
            acc[key] = {
                property: key,
                behavior: include ? 'include' : 'exclude',
            };
            return acc;
        }, {});

        const {shadowBanned} = authorOpts;

        if (shadowBanned !== undefined) {
            try {
                // @ts-ignore
                await item.author.fetch();
                // user is not shadowbanned
                // if criteria specifies they SHOULD be shadowbanned then return false now
                if (shadowBanned) {
                    propResultsMap.shadowBanned!.found = false;
                    propResultsMap.shadowBanned!.passed = false;
                }
            } catch (err: any) {
                if (isStatusError(err) && err.statusCode === 404) {
                    // user is shadowbanned
                    // if criteria specifies they should not be shadowbanned then return false now
                    if (!shadowBanned) {
                        propResultsMap.shadowBanned!.found = true;
                        propResultsMap.shadowBanned!.passed = false;
                    }
                } else {
                    throw err;
                }
            }
        }



        if (propResultsMap.shadowBanned === undefined || propResultsMap.shadowBanned.passed === undefined) {
            try {
                const authorName = getActivityAuthorName(item.author);

                const keys = Object.keys(propResultsMap) as (keyof AuthorCriteria)[]

                let shouldContinue = true;
                for (const k of keys) {
                    if (k === 'shadowBanned') {
                        // we have already taken care of this with shadowban check above
                        continue;
                    }

                    const authorOptVal = definedAuthorOpts[k];

                    //if (authorOpts[k] !== undefined) {
                    switch (k) {
                        case 'name':
                            const nameVal = authorOptVal as RequiredAuthorCrit['name'];
                            const authPass = () => {

                                for (const n of nameVal) {
                                    if (n.toLowerCase() === authorName.toLowerCase()) {
                                        return true;
                                    }
                                }
                                return false;
                            }
                            const authResult = authPass();
                            propResultsMap.name!.found = authorName;
                            propResultsMap.name!.passed = !((include && !authResult) || (!include && authResult));
                            if (!propResultsMap.name!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'flairCssClass':
                            const css = await item.author_flair_css_class;
                            propResultsMap.flairCssClass!.found = css;

                            let cssResult:boolean;

                            if (typeof authorOptVal === 'boolean') {
                                if (authorOptVal === true) {
                                    cssResult = css !== undefined && css !== null && css !== '';
                                } else {
                                    cssResult = css === undefined || css === null || css === '';
                                }
                            } else if (css === undefined || css === null || css === '') {
                                // if crit is not a boolean but property is "empty" then it'll never pass anyway
                                cssResult = false;
                            } else {
                                const opts = Array.isArray(authorOptVal) ? authorOptVal as string[] : [authorOptVal] as string[];
                                cssResult = opts.some(x => x.trim().toLowerCase() === css.trim().toLowerCase())
                            }

                            propResultsMap.flairCssClass!.passed = !((include && !cssResult) || (!include && cssResult));
                            if (!propResultsMap.flairCssClass!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'flairText':

                            const text = await item.author_flair_text;
                            propResultsMap.flairText!.found = text;

                            let textResult: boolean;
                            if (typeof authorOptVal === 'boolean') {
                                if (authorOptVal === true) {
                                    textResult = text !== undefined && text !== null && text !== '';
                                } else {
                                    textResult = text === undefined || text === null || text === '';
                                }
                            } else if (text === undefined || text === null) {
                                // if crit is not a boolean but property is "empty" then it'll never pass anyway
                                textResult = false;
                            } else {
                                const opts = Array.isArray(authorOptVal) ? authorOptVal as string[] : [authorOptVal] as string[];
                                textResult = opts.some(x => x.trim().toLowerCase() === text.trim().toLowerCase())
                            }
                            propResultsMap.flairText!.passed = !((include && !textResult) || (!include && textResult));
                            if (!propResultsMap.flairText!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'flairTemplate':
                            const templateId = await item.author_flair_template_id;
                            propResultsMap.flairTemplate!.found = templateId;

                            let templateResult: boolean;
                            if (typeof authorOptVal === 'boolean') {
                                if (authorOptVal === true) {
                                    templateResult = templateId !== undefined && templateId !== null && templateId !== '';
                                } else {
                                    templateResult = templateId === undefined || templateId === null || templateId === '';
                                }
                            } else if (templateId === undefined || templateId === null || templateId === '') {
                                // if crit is not a boolean but property is "empty" then it'll never pass anyway
                                templateResult = false;
                            } else {
                                const opts = Array.isArray(authorOptVal) ? authorOptVal as string[] : [authorOptVal] as string[];
                                templateResult = opts.some(x => x.trim() === templateId);
                            }

                            propResultsMap.flairTemplate!.passed = !((include && !templateResult) || (!include && templateResult));
                            if (!propResultsMap.flairTemplate!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'isMod':
                            const mods: RedditUser[] = await this.getSubredditModerators(item.subreddit);
                            const isModerator = mods.some(x => x.name === authorName) || authorName.toLowerCase() === 'automoderator';
                            const modMatch = authorOptVal === isModerator;
                            propResultsMap.isMod!.found = isModerator;
                            propResultsMap.isMod!.passed = !((include && !modMatch) || (!include && modMatch));
                            if (!propResultsMap.isMod!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'isContributor':
                            const contributors: RedditUser[] = await this.getSubredditContributors();
                            const isContributor= contributors.some(x => x.name === authorName);
                            const contributorMatch = authorOptVal === isContributor;
                            propResultsMap.isContributor!.found = isContributor;
                            propResultsMap.isContributor!.passed = !((include && !contributorMatch) || (!include && contributorMatch));
                            if (!propResultsMap.isContributor!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'age':
                            // @ts-ignore
                            const authorAge = dayjs.unix((await user()).created);
                            const ageTest = compareDurationValue(parseDurationComparison(await authorOpts.age as string), authorAge);
                            propResultsMap.age!.found = authorAge.fromNow(true);
                            propResultsMap.age!.passed = !((include && !ageTest) || (!include && ageTest));
                            if (!propResultsMap.age!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'linkKarma':
                            // @ts-ignore
                            const tk = (await user()).total_karma as number;
                            const lkCompare = parseGenericValueOrPercentComparison(await authorOpts.linkKarma as string);
                            let lkMatch;
                            if (lkCompare.isPercent) {

                                lkMatch = comparisonTextOp(item.author.link_karma / tk, lkCompare.operator, lkCompare.value / 100);
                            } else {
                                lkMatch = comparisonTextOp(item.author.link_karma, lkCompare.operator, lkCompare.value);
                            }
                            propResultsMap.linkKarma!.found = tk;
                            propResultsMap.linkKarma!.passed = !((include && !lkMatch) || (!include && lkMatch));
                            if (!propResultsMap.linkKarma!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'commentKarma':
                            // @ts-ignore
                            const ck = (await user()).comment_karma as number;
                            const ckCompare = parseGenericValueOrPercentComparison(await authorOpts.commentKarma as string);
                            let ckMatch;
                            if (ckCompare.isPercent) {
                                ckMatch = comparisonTextOp(item.author.comment_karma / ck, ckCompare.operator, ckCompare.value / 100);
                            } else {
                                ckMatch = comparisonTextOp(item.author.comment_karma, ckCompare.operator, ckCompare.value);
                            }
                            propResultsMap.commentKarma!.found = ck;
                            propResultsMap.commentKarma!.passed = !((include && !ckMatch) || (!include && ckMatch));
                            if (!propResultsMap.commentKarma!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'totalKarma':
                            // @ts-ignore
                            const totalKarma = (await user()).total_karma as number;
                            const tkCompare = parseGenericValueComparison(await authorOpts.totalKarma as string);
                            if (tkCompare.isPercent) {
                                throw new SimpleError(`'totalKarma' value on AuthorCriteria cannot be a percentage`);
                            }
                            const tkMatch = comparisonTextOp(totalKarma, tkCompare.operator, tkCompare.value);
                            propResultsMap.totalKarma!.found = totalKarma;
                            propResultsMap.totalKarma!.passed = !((include && !tkMatch) || (!include && tkMatch));
                            if (!propResultsMap.totalKarma!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'verified':
                            // @ts-ignore
                            const verified = (await user()).has_verified_mail;
                            const vMatch = verified === authorOpts.verified as boolean;
                            propResultsMap.verified!.found = verified;
                            propResultsMap.verified!.passed = !((include && !vMatch) || (!include && vMatch));
                            if (!propResultsMap.verified!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'description':
                            // @ts-ignore
                            const desc = (await user()).subreddit?.display_name.public_description;
                            const dVals = authorOpts[k] as string[];
                            let passed = false;
                            let passReg;
                            for (const val of dVals) {
                                let reg = parseStringToRegex(val, 'i');
                                if (reg === undefined) {
                                    reg = parseStringToRegex(`/.*${escapeRegex(val.trim())}.*/`, 'i');
                                    if (reg === undefined) {
                                        throw new SimpleError(`Could not convert 'description' value to a valid regex: ${authorOpts[k] as string}`);
                                    }
                                }
                                if (reg.test(desc)) {
                                    passed = true;
                                    passReg = reg.toString();
                                    break;
                                }
                            }
                            propResultsMap.description!.found = typeof desc === 'string' ? truncateStringToLength(50)(desc) : desc;
                            propResultsMap.description!.passed = !((include && !passed) || (!include && passed));
                            if (!propResultsMap.description!.passed) {
                                shouldContinue = false;
                            } else {
                                propResultsMap.description!.reason = `Matched with: ${passReg as string}`;
                            }
                            break;
                        case 'userNotes':
                            const notes = await this.userNotes.getUserNotes(item.author);
                            let foundNoteResult: string[] = [];
                            const notePass = () => {
                                for (const noteCriteria of authorOpts[k] as UserNoteCriteria[]) {
                                    const {count = '>= 1', search = 'current', type} = noteCriteria;
                                    const {
                                        value,
                                        operator,
                                        isPercent,
                                        extra = ''
                                    } = parseGenericValueOrPercentComparison(count);
                                    const order = extra.includes('asc') ? 'ascending' : 'descending';
                                    switch (search) {
                                        case 'current':
                                            if (notes.length > 0) {
                                                const currentNoteType = notes[notes.length - 1].noteType;
                                                foundNoteResult.push(`Current => ${currentNoteType}`);
                                                if (currentNoteType === type) {
                                                    return true;
                                                }
                                            } else {
                                                foundNoteResult.push('No notes present');
                                            }
                                            break;
                                        case 'consecutive':
                                            let orderedNotes = notes;
                                            if (order === 'descending') {
                                                orderedNotes = [...notes];
                                                orderedNotes.reverse();
                                            }
                                            let currCount = 0;
                                            for (const note of orderedNotes) {
                                                if (note.noteType === type) {
                                                    currCount++;
                                                } else {
                                                    currCount = 0;
                                                }
                                                if (isPercent) {
                                                    throw new SimpleError(`When comparing UserNotes with 'consecutive' search 'count' cannot be a percentage. Given: ${count}`);
                                                }
                                                foundNoteResult.push(`Found ${currCount} ${type} consecutively`);
                                                if (comparisonTextOp(currCount, operator, value)) {
                                                    return true;
                                                }
                                            }
                                            break;
                                        case 'total':
                                            const filteredNotes = notes.filter(x => x.noteType === type);
                                            if (isPercent) {
                                                // avoid divide by zero
                                                const percent = notes.length === 0 ? 0 : filteredNotes.length / notes.length;
                                                foundNoteResult.push(`${formatNumber(percent)}% are ${type}`);
                                                if (comparisonTextOp(percent, operator, value / 100)) {
                                                    return true;
                                                }
                                            } else {
                                                foundNoteResult.push(`${filteredNotes.length} are ${type}`);
                                                if (comparisonTextOp(notes.filter(x => x.noteType === type).length, operator, value)) {
                                                    return true;
                                                }
                                            }
                                            break;
                                    }
                                }
                                return false;
                            }
                            const noteResult = notePass();
                            propResultsMap.userNotes!.found = foundNoteResult.join(' | ');
                            propResultsMap.userNotes!.passed = !((include && !noteResult) || (!include && noteResult));
                            if (!propResultsMap.userNotes!.passed) {
                                shouldContinue = false;
                            }
                            break;
                    }
                    //}
                    if (!shouldContinue) {
                        break;
                    }
                }
            } catch (err: any) {
                if (isStatusError(err) && err.statusCode === 404) {
                    throw new SimpleError('Reddit returned a 404 while trying to retrieve User profile. It is likely this user is shadowbanned.');
                } else {
                    throw err;
                }
            }
        }

        // gather values and determine overall passed
        const propResults = Object.values(propResultsMap);
        const passed = propResults.filter(x => typeof x.passed === 'boolean').every(x => x.passed === true);

        return {
            behavior: include ? 'include' : 'exclude',
            criteria: authorOpts,
            propertyResults: propResults,
            passed,
        };
    }

    async getCommentCheckCacheResult(item: Comment, checkConfig: object): Promise<UserResultCache | undefined> {
        const userName = getActivityAuthorName(item.author);
        const hash = `commentUserResult-${userName}-${item.link_id}-${objectHash.sha1(checkConfig)}`;
        this.stats.cache.commentCheck.requests++;
        this.stats.cache.commentCheck.requestTimestamps.push(Date.now());
        await this.stats.cache.commentCheck.identifierRequestCount.set(hash, (await this.stats.cache.commentCheck.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
        let result = await this.cache.get(hash) as UserResultCache | undefined | null;
        if(result === null) {
            result = undefined;
        }
        if(result === undefined) {
            this.stats.cache.commentCheck.miss++;
        }
        this.logger.debug(`Cache Hit: Comment Check for ${userName} in Submission ${item.link_id} (Hash ${hash})`);
        return result;
    }

    async setCommentCheckCacheResult(item: Comment, checkConfig: object, result: UserResultCache, ttl: number) {
        const userName = getActivityAuthorName(item.author);
        const hash = `commentUserResult-${userName}-${item.link_id}-${objectHash.sha1(checkConfig)}`
        await this.cache.set(hash, result, { ttl });
        this.logger.debug(`Cached check result '${result.result}' for User ${userName} on Submission ${item.link_id} for ${ttl} seconds (Hash ${hash})`);
    }

    async generateFooter(item: Submission | Comment, actionFooter?: false | string) {
        let footer = actionFooter !== undefined ? actionFooter : this.footer;
        if (footer === false) {
            return '';
        }
        const subName = await item.subreddit.display_name;
        const permaLink = `https://reddit.com${await item.permalink}`
        const modmailLink = `https://www.reddit.com/message/compose?to=%2Fr%2F${subName}&message=${encodeURIComponent(permaLink)}`

        const footerRawContent = await this.getContent(footer, item.subreddit);
        return he.decode(Mustache.render(footerRawContent, {subName, permaLink, modmailLink, botLink: BOT_LINK}));
    }

    async getImageHash(img: ImageData): Promise<string|undefined> {
        const hash = `imgHash-${img.baseUrl}`;
        const result = await this.cache.get(hash) as string | undefined | null;
        this.stats.cache.imageHash.requests++
        this.stats.cache.imageHash.requestTimestamps.push(Date.now());
        await this.stats.cache.imageHash.identifierRequestCount.set(hash, (await this.stats.cache.imageHash.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
        if(result !== undefined && result !== null) {
            return result;
        }
        this.stats.cache.commentCheck.miss++;
        return undefined;
        // const hash = await this.cache.wrap(img.baseUrl, async () => await img.hash(true), { ttl }) as string;
        // if(img.hashResult === undefined) {
        //     img.hashResult = hash;
        // }
        // return hash;
    }

    async setImageHash(img: ImageData, hash: string, ttl: number): Promise<void> {
        await this.cache.set(`imgHash-${img.baseUrl}`, hash, {ttl});
        // const hash = await this.cache.wrap(img.baseUrl, async () => await img.hash(true), { ttl }) as string;
        // if(img.hashResult === undefined) {
        //     img.hashResult = hash;
        // }
        // return hash;
    }

    getThirdPartyCredentials(name: string) {
        if(this.thirdPartyCredentials[name] !== undefined) {
            return this.thirdPartyCredentials[name];
        }
        return undefined;
    }
}

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
            caching,
        } = config;
        caching.provider.prefix = buildCachePrefix([caching.provider.prefix, 'SHARED']);
        const {actionedEventsMax: eMax, actionedEventsDefault: eDef, ...relevantCacheSettings} = caching;
        this.cacheHash = objectHash.sha1(relevantCacheSettings);
        this.defaultCacheConfig = caching;
        this.defaultThirdPartyCredentials = thirdParty;
        this.ttlDefaults = {authorTTL, userNotesTTL, wikiTTL, commentTTL, submissionTTL, filterCriteriaTTL, subredditTTL, selfTTL};
        this.logger = logger;

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
        const { caching, credentials, ...init } = initOptions;

        let opts: SubredditResourceOptions = {
            cache: this.defaultCache,
            cacheType: this.cacheType,
            cacheSettingsHash: hash,
            ttl: this.ttlDefaults,
            thirdPartyCredentials: credentials ?? this.defaultThirdPartyCredentials,
            prefix: this.defaultCacheConfig.provider.prefix,
            actionedEventsMax: this.actionedEventsMaxDefault !== undefined ? Math.min(this.actionedEventsDefault, this.actionedEventsMaxDefault) : this.actionedEventsDefault,
            ...init,
        };

        if(caching !== undefined) {
            const {provider = this.defaultCacheConfig.provider, actionedEventsMax = this.actionedEventsDefault, ...rest} = caching;
            let cacheConfig = {
                provider: buildCacheOptionsFromProvider(provider),
                ttl: {
                    ...this.ttlDefaults,
                    ...rest
                },
            }
            hash = objectHash.sha1(cacheConfig);
            // only need to create private if there settings are actually different than the default
            if(hash !== this.cacheHash) {
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
                    ...init,
                    ...trueRest,
                };
                await runMigrations(opts.cache, opts.logger, trueProvider.prefix);
            }
        } else if(!this.defaultCacheMigrated) {
            await runMigrations(this.defaultCache, this.logger, opts.prefix);
            this.defaultCacheMigrated = true;
        }

        let resource: SubredditResources;
        const res = this.get(subName);
        if(res === undefined || res.cacheSettingsHash !== hash) {
            resource = new SubredditResources(subName, {...opts, delayedItems: res?.delayedItems, botAccount: this.botAccount});
            await resource.initHistoricalStats();
            resource.setHistoricalSaveInterval();
            this.resources.set(subName, resource);
        } else {
            // just set non-cache related settings
            resource = res;
            resource.botAccount = this.botAccount;
            if(opts.footer !== resource.footer) {
                resource.footer = opts.footer || DEFAULT_FOOTER;
            }
            // reset cache stats when configuration is reloaded
            resource.stats.cache = cacheStats();
        }
        resource.stats.historical.lastReload = createHistoricalDefaults();

        return resource;
    }

    async getPendingSubredditInvites(): Promise<(string[])> {
        const subredditNames = await this.defaultCache.get(`modInvites`);
        if (subredditNames !== undefined && subredditNames !== null) {
            return subredditNames as string[];
        }
        return [];
    }

    async addPendingSubredditInvite(subreddit: string): Promise<void> {
        let subredditNames = await this.defaultCache.get(`modInvites`) as (string[] | undefined | null);
        if (subredditNames === undefined || subredditNames === null) {
            subredditNames = [];
        }
        subredditNames.push(subreddit);
        await this.defaultCache.set(`modInvites`, subredditNames, {ttl: 0});
        return;
    }

    async deletePendingSubredditInvite(subreddit: string): Promise<void> {
        let subredditNames = await this.defaultCache.get(`modInvites`) as (string[] | undefined | null);
        if (subredditNames === undefined || subredditNames === null) {
            subredditNames = [];
        }
        subredditNames = subredditNames.filter(x => x !== subreddit);
        await this.defaultCache.set(`modInvites`, subredditNames, {ttl: 0});
        return;
    }

    async clearPendingSubredditInvites(): Promise<void> {
        await this.defaultCache.del(`modInvites`);
        return;
    }
}

export const checkAuthorFilter = async (item: (Submission | Comment), filter: AuthorOptions, resources: SubredditResources, logger: Logger): Promise<[boolean, ('inclusive' | 'exclusive' | undefined), FilterResult<AuthorCriteria>]> => {
    const authLogger = logger.child({labels: ['Author Filter']}, mergeArr);
    const {
        include = [],
        excludeCondition = 'AND',
        exclude = [],
    } = filter;
    let authorPass = null;
    const allCritResults: FilterCriteriaResult<AuthorCriteria>[] = [];
    if (include.length > 0) {
        let index = 1;
        for (const auth of include) {
            const critResult = await resources.testAuthorCriteria(item, auth);
            allCritResults.push(critResult);
            const [summary, details] = filterCriteriaSummary(critResult);
            if (critResult.passed) {
                authLogger.verbose(`${PASS} => Inclusive Author Criteria ${index} => ${summary}`);
                authLogger.debug(`Criteria Details: \n${details.join('\n')}`);
                return [true, 'inclusive', {criteriaResults: allCritResults, join: 'OR', passed: true}];
            } else {
                authLogger.debug(`${FAIL} => Inclusive Author Criteria ${index} => ${summary}`);
                authLogger.debug(`Criteria Details: \n${details.join('\n')}`);
            }
            index++;
        }
        authLogger.verbose(`${FAIL} => No Inclusive Author Criteria matched`);
        return [false, 'inclusive', {criteriaResults: allCritResults, join: 'OR', passed: false}];
    }
    if (exclude.length > 0) {
        let index = 1;
        const summaries: string[] = [];
        for (const auth of exclude) {
            const critResult = await resources.testAuthorCriteria(item, auth, false);
            allCritResults.push(critResult);
            const [summary, details] = filterCriteriaSummary(critResult);
            if (critResult.passed) {
                if(excludeCondition === 'OR') {
                    authLogger.verbose(`${PASS} (OR) => Exclusive Author Criteria ${index} => ${summary}`);
                    authLogger.debug(`Criteria Details: \n${details.join('\n')}`);
                    authorPass = true;
                    break;
                }
                summaries.push(summary);
                authLogger.debug(`${PASS} (AND) => Exclusive Author Criteria ${index} => ${summary}`);
                authLogger.debug(`Criteria Details: \n${details.join('\n')}`);
            } else if (!critResult.passed) {
                if(excludeCondition === 'AND') {
                    authLogger.verbose(`${FAIL} (AND) => Exclusive Author Criteria ${index} => ${summary}`);
                    authLogger.debug(`Criteria Details: \n${details.join('\n')}`);
                    authorPass = false;
                    break;
                }
                summaries.push(summary);
                authLogger.debug(`${FAIL} (OR) => Exclusive Author Criteria ${index} => ${summary}`);
                authLogger.debug(`Criteria Details: \n${details.join('\n')}`);
            }
            index++;
        }
        if(excludeCondition === 'AND' && authorPass === null) {
            authorPass = true;
        }
        if (authorPass !== true) {
            if(excludeCondition === 'OR') {
                authLogger.verbose(`${FAIL} => Exclusive author criteria not matched => ${summaries.length === 1 ? `${summaries[0]}` : '(many, see debug)'}`);
            }
            return [false, 'exclusive', {criteriaResults: allCritResults, join: excludeCondition, passed: false}]
        } else if(excludeCondition === 'AND') {
            authLogger.verbose(`${PASS} => Exclusive author criteria matched => ${summaries.length === 1 ? `${summaries[0]}` : '(many, see debug)'}`);
        }
        return [true, 'exclusive', {criteriaResults: allCritResults, join: excludeCondition, passed: true}];
    }
    return [true, undefined, {criteriaResults: allCritResults, join: 'OR', passed: true}];
}

export const checkItemFilter = async (item: (Submission | Comment), filter: TypedActivityStates, resources: SubredditResources, parentLogger: Logger, source?: ActivitySource): Promise<[boolean, ('inclusive' | 'exclusive' | undefined), FilterResult<TypedActivityState>]> => {
    const logger = parentLogger.child({labels: ['Item Filter']}, mergeArr);

    const allCritResults: FilterCriteriaResult<TypedActivityState>[] = [];

    if(filter.length > 0) {
        let index = 1
        for(const state of filter) {
            let critResult: FilterCriteriaResult<TypedActivityState>;

            // need to determine if criteria is for comment or submission state
            // and if its comment state WITH submission state then break apart testing into individual activity testing
            if(isCommentState(state) && isComment(item) && state.submissionState !== undefined) {
                const {submissionState, ...restCommentState} = state;
                // test submission state first since it's more likely(??) we have crit results or cache data for this submission than for the comment

                // get submission
                // @ts-ignore
                const subProxy = await resources.client.getSubmission(await item.link_id);
                // @ts-ignore
                const sub = await resources.getActivity(subProxy);
                const [subPass, _, subFilterResults] = await checkItemFilter(sub, submissionState, resources, parentLogger);
                const subPropertyResult: FilterCriteriaPropertyResult<CommentState> = {
                    property: 'submissionState',
                    behavior: 'include',
                    passed: subPass,
                    found: {
                        join: 'OR',
                        criteriaResults: subFilterResults.criteriaResults,
                        passed: subPass,
                    }
                };

                if(!subPass) {
                    // generate dummy results for the rest of the comment state since we don't need to test it
                    const [propResultsMap, definedStateCriteria] = generateItemFilterHelpers(restCommentState);
                    propResultsMap.submissionState = subPropertyResult;
                    critResult = {
                        behavior: 'include',
                        criteria: state,
                        propertyResults: Object.values(propResultsMap),
                        passed: false
                    }
                } else {
                    critResult = await resources.testItemCriteria(item, restCommentState, parentLogger, source);
                    critResult.criteria = state;
                    critResult.propertyResults.unshift(subPropertyResult);
                }
            } else {
                critResult = await resources.testItemCriteria(item, state, parentLogger, source);
            }

            //critResult = await resources.testItemCriteria(item, state, parentLogger);
            allCritResults.push(critResult);
            const [summary, details] = filterCriteriaSummary(critResult);
            if (critResult.passed) {
                logger.verbose(`${PASS} => Item Criteria ${index} => ${summary}`);
                logger.debug(`Criteria Details: \n${details.join('\n')}`);
                return [true, 'inclusive', {criteriaResults: allCritResults, join: 'OR', passed: true}];
            } else {
                logger.debug(`${FAIL} => Item Author Criteria ${index} => ${summary}`);
                logger.debug(`Criteria Details: \n${details.join('\n')}`);
            }
            index++;
        }
        logger.verbose(`${FAIL} => No Item Criteria matched`);
        return [false, 'inclusive', {criteriaResults: allCritResults, join: 'OR', passed: false}];
    }

    return [true, undefined, {criteriaResults: allCritResults, join: 'OR', passed: true}];
}
