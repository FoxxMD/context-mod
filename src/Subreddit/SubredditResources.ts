import Snoowrap, {Listing} from "snoowrap";
import objectHash from 'object-hash';
import {
    activityIsDeleted, activityIsFiltered,
    activityIsRemoved,
    AuthorTypedActivitiesOptions, BOT_LINK,
    getAuthorHistoryAPIOptions, renderContent
} from "../Utils/SnoowrapUtils";
import {map as mapAsync} from 'async';
import winston, {Logger} from "winston";
import as from 'async';
import fetch, {Response} from 'node-fetch';
import {
    asActivity,
    asSubmission,
    asUserNoteCriteria,
    buildCacheOptionsFromProvider,
    buildCachePrefix,
    cacheStats,
    createCacheManager,
    escapeRegex,
    FAIL,
    fetchExternalResult,
    filterCriteriaSummary,
    formatNumber,
    generateItemFilterHelpers,
    getActivityAuthorName,
    getActivitySubredditName,
    isComment,
    isCommentState,
    isStrongSubredditState,
    isSubmission,
    isUser,
    hashString,
    mergeArr,
    parseExternalUrl,
    parseRedditEntity,
    parseStringToRegex,
    parseWikiContext,
    PASS,
    redisScanIterator,
    removeUndefinedKeys,
    shouldCacheSubredditStateCriteriaResult,
    strToActivitySource,
    subredditStateIsNameOnly,
    testMaybeStringRegex,
    toStrongSubredditState,
    truncateStringToLength,
    userNoteCriteriaSummary,
    asComment,
    criteriaPassWithIncludeBehavior,
    isRuleSetResult,
    frequencyEqualOrLargerThanMin,
    parseDurationValToDuration,
    windowConfigToWindowCriteria,
    asStrongSubredditState,
    convertSubredditsRawToStrong,
    filterByTimeRequirement,
    asSubreddit,
    modActionCriteriaSummary,
    parseRedditFullname
} from "../util";
import LoggedError from "../Utils/LoggedError";
import {
    BotInstanceConfig,
    CacheOptions,
    Footer,
    OperatorConfig,
    ResourceStats,
    StrongCache,
    CacheConfig,
    TTLConfig,
    UserResultCache,
    ActionedEvent,
    ThirdPartyCredentialsJsonConfig,
    RequiredItemCrit,
    ItemCritPropHelper,
    ActivityDispatch,
    HistoricalStatsDisplay
} from "../Common/interfaces";
import UserNotes from "./UserNotes";
import Mustache from "mustache";
import he from "he";
import {SPoll} from "./Streams";
import {Cache} from 'cache-manager';
import {Submission, Comment, Subreddit, RedditUser} from "snoowrap/dist/objects";
import {
    cacheTTLDefaults,
    createHistoricalDisplayDefaults,
} from "../Common/defaults";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";
import dayjs, {Dayjs} from "dayjs";
import ImageData from "../Common/ImageData";
import {DataSource, Repository, SelectQueryBuilder, Between, LessThan, DeleteQueryBuilder} from "typeorm";
import {CMEvent as ActionedEventEntity, CMEvent } from "../Common/Entities/CMEvent";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import globrex from 'globrex';
import {runMigrations} from "../Common/Migrations/CacheMigrationUtils";
import {CMError, isStatusError, MaybeSeriousErrorWithCause, SimpleError} from "../Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {ManagerEntity} from "../Common/Entities/ManagerEntity";
import {Bot} from "../Common/Entities/Bot";
import {DispatchedEntity} from "../Common/Entities/DispatchedEntity";
import {ActivitySourceEntity} from "../Common/Entities/ActivitySourceEntity";
import {TotalStat} from "../Common/Entities/Stats/TotalStat";
import {TimeSeriesStat} from "../Common/Entities/Stats/TimeSeriesStat";
import {InvokeeType} from "../Common/Entities/InvokeeType";
import {RunStateType} from "../Common/Entities/RunStateType";
import {CheckResultEntity} from "../Common/Entities/CheckResultEntity";
import {RuleSetResultEntity} from "../Common/Entities/RuleSetResultEntity";
import {RulePremise} from "../Common/Entities/RulePremise";
import cloneDeep from "lodash/cloneDeep";
import {
    asModLogCriteria,
    asModNoteCriteria,
    AuthorCriteria, CommentState, ModLogCriteria, ModNoteCriteria, orderedAuthorCriteriaProps, RequiredAuthorCrit,
    StrongSubredditCriteria, SubmissionState,
    SubredditCriteria, toFullModLogCriteria, toFullModNoteCriteria, TypedActivityState, TypedActivityStates,
    UserNoteCriteria
} from "../Common/Infrastructure/Filters/FilterCriteria";
import {
    ActivitySource, ConfigFragmentValidationFunc, DurationVal,
    EventRetentionPolicyRange,
    JoinOperands,
    ModActionType,
    ModeratorNameCriteria, ModUserNoteLabel, statFrequencies, StatisticFrequency,
    StatisticFrequencyOption
} from "../Common/Infrastructure/Atomic";
import {
    AuthorOptions, FilterCriteriaPropertyResult,
    FilterCriteriaResult,
    FilterResult,
    ItemOptions,
    NamedCriteria
} from "../Common/Infrastructure/Filters/FilterShapes";
import {
    ActivityWindowCriteria,
    HistoryFiltersOptions,
    ListingFunc,
    NamedListing
} from "../Common/Infrastructure/ActivityWindow";
import {Duration} from "dayjs/plugin/duration";
import {
    activityReports,

    ActivityType,
    AuthorHistorySort,
    CachedFetchedActivitiesResult, FetchedActivitiesResult,
    SnoowrapActivity
} from "../Common/Infrastructure/Reddit";
import {AuthorCritPropHelper} from "../Common/Infrastructure/Filters/AuthorCritPropHelper";
import {NoopLogger} from "../Utils/loggerFactory";
import {
    compareDurationValue, comparisonTextOp,
    parseDurationComparison,
    parseGenericValueComparison,
    parseGenericValueOrPercentComparison, parseReportComparison
} from "../Common/Infrastructure/Comparisons";
import {asCreateModNoteData, CreateModNoteData, ModNote, ModNoteRaw} from "./ModNotes/ModNote";
import {IncludesData} from "../Common/Infrastructure/Includes";
import {parseFromJsonOrYamlToObject} from "../Common/Config/ConfigUtil";
import ConfigParseError from "../Utils/ConfigParseError";
import {ActivityReport} from "../Common/Entities/ActivityReport";

export const DEFAULT_FOOTER = '\r\n*****\r\nThis action was performed by [a bot.]({{botLink}}) Mention a moderator or [send a modmail]({{modmailLink}}) if you any ideas, questions, or concerns about this action.';

/**
 * Only used for migrating stats from cache to db
 * */
interface OldHistoricalStats {
    eventsCheckedTotal: number
    eventsActionedTotal: number
    checksRun: Map<string, number>
    checksFromCache: Map<string, number>
    checksTriggered: Map<string, number>
    rulesRun: Map<string, number>
    //rulesCached: Map<string, number>
    rulesCachedTotal: number
    rulesTriggered: Map<string, number>
    actionsRun: Map<string, number>
    [index: string]: any
}

export interface SubredditResourceConfig extends Footer {
    caching?: CacheConfig,
    subreddit: Subreddit,
    logger: Logger;
    client: ExtendedSnoowrap
    credentials?: ThirdPartyCredentialsJsonConfig
    managerEntity: ManagerEntity
    botEntity: Bot
    statFrequency: StatisticFrequencyOption
    retention?: EventRetentionPolicyRange
}

interface SubredditResourceOptions extends Footer {
    ttl: Required<TTLConfig>
    cache: Cache
    cacheType: string;
    cacheSettingsHash: string
    subreddit: Subreddit,
    database: DataSource
    logger: Logger;
    client: ExtendedSnoowrap;
    prefix?: string;
    actionedEventsMax: number;
    thirdPartyCredentials: ThirdPartyCredentialsJsonConfig
    delayedItems?: ActivityDispatch[]
    botAccount?: string
    botName: string
    managerEntity: ManagerEntity
    botEntity: Bot
    statFrequency: StatisticFrequencyOption
    retention?: EventRetentionPolicyRange
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
    protected modNotesTTL: number | false = cacheTTLDefaults.modNotesTTL;
    public selfTTL: number | false = cacheTTLDefaults.selfTTL;
    name: string;
    botName: string;
    protected logger: Logger;
    userNotes: UserNotes;
    footer: false | string = DEFAULT_FOOTER;
    subreddit: Subreddit
    database: DataSource
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
    dispatchedActivityRepo: Repository<DispatchedEntity>
    activitySourceRepo: Repository<ActivitySourceEntity>
    totalStatsRepo: Repository<TotalStat>
    totalStatsEntities?: TotalStat[];
    tsStatsRepo: Repository<TimeSeriesStat>
    timeSeriesStatsEntities?: TimeSeriesStat[];
    statFrequency: StatisticFrequencyOption
    retention?: EventRetentionPolicyRange
    managerEntity: ManagerEntity
    botEntity: Bot

    stats: {
        cache: ResourceStats
        historical: HistoricalStatsDisplay
        timeSeries: HistoricalStatsDisplay
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
                modNotesTTL,
            },
            botName,
            database,
            cache,
            prefix,
            cacheType,
            actionedEventsMax,
            cacheSettingsHash,
            client,
            thirdPartyCredentials,
            delayedItems = [],
            botAccount,
            managerEntity,
            botEntity,
            statFrequency,
            retention
        } = options || {};

        this.managerEntity = managerEntity;
        this.botEntity = botEntity;
        this.botName = botName;
        this.delayedItems = delayedItems;
        this.cacheSettingsHash = cacheSettingsHash;
        this.cache = cache;
        this.database = database;
        this.dispatchedActivityRepo = this.database.getRepository(DispatchedEntity);
        this.activitySourceRepo = this.database.getRepository(ActivitySourceEntity);
        this.totalStatsRepo = this.database.getRepository(TotalStat);
        this.tsStatsRepo = this.database.getRepository(TimeSeriesStat);
        this.statFrequency = statFrequency;
        this.retention = retention;
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
        this.modNotesTTL = modNotesTTL === true ? 0 : modNotesTTL;
        this.selfTTL = selfTTL === true ? 0 : selfTTL;
        this.subreddit = subreddit;
        this.thirdPartyCredentials = thirdPartyCredentials;
        this.name = name;
        this.botAccount = botAccount;
        if (logger === undefined) {
            const alogger = winston.loggers.get('app')
            this.logger = alogger.child({labels: [this.name, 'Resources']}, mergeArr);
        } else {
            this.logger = logger.child({labels: ['Resources']}, mergeArr);
        }

        this.stats = {
            cache: cacheStats(),
            historical: createHistoricalDisplayDefaults(),
            timeSeries: createHistoricalDisplayDefaults(),
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
                    this.cache?.store.prune();
                    this.logger.debug('Pruned cache');
                    // prune interval should be twice the smallest TTL
                },min * 1000 * 2)
            }
        }

        if(this.retention === undefined) {
            this.logger.verbose('Events will be stored in database indefinitely.', {leaf: 'Event Retention'});
        } else if(typeof this.retention === 'number') {
            this.logger.verbose(`Will retain the last ${this.retention} events in database`, {leaf: 'Event Retention'});
        } else {
            try {
                const dur = parseDurationValToDuration(this.retention as DurationVal);
                this.logger.verbose(`Will retain events processed within the last ${dur.humanize()} in database`, {leaf: 'Event Retention'});
            } catch (e) {
                this.retention = undefined;
                this.logger.error(new ErrorWithCause('Could not parse retention as a valid duration. Retention enforcement is disabled.', {cause: e}));
            }
        }
    }

    async destroy() {
        if(this.historicalSaveInterval !== undefined) {
            clearInterval(this.historicalSaveInterval);
        }
        if(this.pruneInterval !== undefined && this.cacheType === 'memory' && this.cacheSettingsHash !== 'default') {
            clearInterval(this.pruneInterval);
            this.cache?.reset();
        }
    }

    async retentionCleanup() {
        const logger = this.logger.child({labels: ['Event Retention'], mergeArr});
        logger.debug('Starting cleanup');
        if (this.retention === undefined) {
            logger.debug('Nothing to cleanup because there is no retention policy! finished.');
            return;
        }
        let count = 0;

        try {
            let deleteQuery: DeleteQueryBuilder<CMEvent>; // = this.database.getRepository(CMEvent).createQueryBuilder();

            if (typeof this.retention === 'number') {
                const idQuery = this.database.getRepository(CMEvent).createQueryBuilder('event');
                idQuery
                    .select('event.id')
                    .where({manager: {id: this.managerEntity.id}})
                    .orderBy('event._processedAt', 'DESC')
                    .skip(this.retention);

                const res = await idQuery.getRawMany();
                count = res.length;

                deleteQuery = this.database.getRepository(CMEvent).createQueryBuilder()
                    .delete()
                    .from(CMEvent, 'event')
                    .whereInIds(res.map(x => x.event_id));

                logger.debug(`Found ${count} Events past the first ${this.retention}`);
            } else {
                const dur = parseDurationValToDuration(this.retention as DurationVal);

                const date = dayjs().subtract(dur.asSeconds(), 'second');

                const res = await this.database.getRepository(CMEvent).createQueryBuilder('event')
                    .select('event.id')
                    .where({_processedAt: LessThan(date.toDate())})
                    .andWhere('event.manager.id = :managerId', {managerId: this.managerEntity.id})
                    .getRawMany();

                count = res.length;

                // for some reason cannot use "normal" where conditions for delete builder -- can only use "raw" parameters
                // so have to use same approach as number and just whereIn all ids from count query

                // deleteQuery = this.database.getRepository(CMEvent).createQueryBuilder()
                //     .delete()
                //     .from(CMEvent, 'event')
                //     .where({_processedAt: LessThan(date.toDate())})
                //     .andWhere('event.manager.id = :managerId', {managerId: this.managerEntity.id})

                deleteQuery = this.database.getRepository(CMEvent).createQueryBuilder()
                    .delete()
                    .from(CMEvent, 'event')
                    .whereInIds(res.map(x => x.event_id));

                logger.debug(`Found ${count} Events older than ${date.format('YY-MM-DD HH:mm:ss z')} (${dur.humanize()})`);
            }

            if (count === 0) {
                logger.debug('Nothing to be done, finished.');
                return;
            }

            logger.debug(`Deleting Events...`);
            await deleteQuery.execute();
            logger.info(`Successfully enforced retention policy. ${count} Events deleted.`);
        } catch (e) {
            logger.error(new ErrorWithCause('Failed to enforce retention policy due to an error', {cause: e}));
        }
    }

    async initDatabaseDelayedActivities() {
        if(this.delayedItems.length === 0) {
            const dispatchedActivities = await this.dispatchedActivityRepo.find({
                where: {
                    manager: {
                        id: this.managerEntity.id
                    }
                },
                relations: {
                    manager: true
                }
            });
            const now = dayjs();
            for(const dAct of dispatchedActivities) {
                const shouldDispatchAt = dAct.createdAt.add(dAct.delay.asSeconds(), 'seconds');
                let tardyHint = '';
                if(shouldDispatchAt.isBefore(now)) {
                    let tardyHint = `Activity ${dAct.activityId} queued at ${dAct.createdAt.format('YYYY-MM-DD HH:mm:ssZ')} for ${dAct.delay.humanize()} is now LATE`;
                    if(dAct.tardyTolerant === true) {
                        tardyHint += ` but was configured as ALWAYS 'tardy tolerant' so will be dispatched immediately`;
                    } else if(dAct.tardyTolerant === false) {
                        tardyHint += ` and was not configured as 'tardy tolerant' so will be dropped`;
                        this.logger.warn(tardyHint);
                        await this.removeDelayedActivity(dAct.id);
                        continue;
                    } else {
                        // see if its within tolerance
                        const latest = shouldDispatchAt.add(dAct.tardyTolerant);
                        if(latest.isBefore(now)) {
                            tardyHint += ` and IS NOT within tardy tolerance of ${dAct.tardyTolerant.humanize()} of planned dispatch time so will be dropped`;
                            this.logger.warn(tardyHint);
                            await this.removeDelayedActivity(dAct.id);
                            continue;
                        } else {
                            tardyHint += `but is within tardy tolerance of ${dAct.tardyTolerant.humanize()} of planned dispatch time so will be dispatched immediately`;
                        }
                    }
                }
                if(tardyHint !== '') {
                    this.logger.warn(tardyHint);
                }
                try {
                    this.delayedItems.push(await dAct.toActivityDispatch(this.client))
                } catch (e) {
                    this.logger.warn(new ErrorWithCause(`Unable to add Activity ${dAct.activityId} from database delayed activities to in-app delayed activities queue`, {cause: e}));
                }
            }
        }
    }

    async addDelayedActivity(data: ActivityDispatch) {
        const dEntity = await this.dispatchedActivityRepo.save(new DispatchedEntity({...data, manager: this.managerEntity}));
        data.id = dEntity.id;
        this.delayedItems.push(data);
    }

    async removeDelayedActivity(val?: string | string[]) {
        if(val === undefined) {
            await this.dispatchedActivityRepo.delete({manager: {id: this.managerEntity.id}});
            this.delayedItems = [];
        } else {
            const ids = typeof val === 'string' ? [val] : val;
            await this.dispatchedActivityRepo.delete(ids);
            this.delayedItems = this.delayedItems.filter(x => !ids.includes(x.id));
        }
    }

    async initStats() {
        // temp migration strategy to transition from cache to db
        try {
            let currentStats: HistoricalStatsDisplay = createHistoricalDisplayDefaults();
            const totalStats = await this.totalStatsRepo.findBy({managerId: this.managerEntity.id});
            if (totalStats.length === 0) {
                const at = await this.cache.get(`${this.name}-historical-allTime`) as null | undefined | OldHistoricalStats;
                if (at !== null && at !== undefined) {
                    // convert to historical stat object
                    const rehydratedAt: any = {};
                    for (const [k, v] of Object.entries(at)) {
                        const t = typeof v;
                        if (t === 'number') {
                            // simple number stat like eventsCheckedTotal
                            rehydratedAt[k] = v;
                        } else if (Array.isArray(v)) {
                            // a map stat that we have data for is serialized as an array of KV pairs
                            const statMap = new Map(v);
                            // @ts-ignore
                            rehydratedAt[`${k}Total`] = Array.from(statMap.values()).reduce((acc, curr) => acc + curr, 0)
                        } else if (v === null || v === undefined || (t === 'object' && Object.keys(v).length === 0)) {
                            // a map stat that was not serialized (for some reason) or serialized without any data
                            rehydratedAt[k] = 0;
                        } else {
                            // ???? shouldn't get here
                            this.logger.warn(`Did not recognize rehydrated historical stat "${k}" of type ${t}`);
                            rehydratedAt[k] = v;
                        }
                    }
                    currentStats = rehydratedAt as HistoricalStatsDisplay;
                }
                const now = dayjs();
                const statEntities: TotalStat[] = [];
                for (const [k, v] of Object.entries(currentStats)) {
                    statEntities.push(new TotalStat({
                        metric: k,
                        value: v,
                        manager: this.managerEntity,
                        createdAt: now,
                    }));
                }
                await this.totalStatsRepo.save(statEntities);
                this.totalStatsEntities = statEntities;
            } else {
                this.totalStatsEntities = totalStats;
                for (const [k, v] of Object.entries(currentStats)) {
                    const matchedStat = totalStats.find(x => x.metric === k);
                    if (matchedStat !== undefined) {
                        currentStats[k] = matchedStat.value;
                    } else {
                        this.logger.warn(`Could not find historical stat matching '${k}' in the database, will default to 0`);
                        currentStats[k] = v;
                    }
                }
            }
            this.stats.historical = currentStats;
        } catch (e) {
            this.logger.error(new ErrorWithCause('Failed to init historical stats', {cause: e}));
        }

        try {
            if(this.statFrequency !== false) {
                let currentStats: HistoricalStatsDisplay = createHistoricalDisplayDefaults();
                let startRange = dayjs().set('second', 0);
                for(const unit of statFrequencies) {
                    if(unit !== 'week' && !frequencyEqualOrLargerThanMin(unit, this.statFrequency)) {
                        startRange = startRange.set(unit, 0);
                    }
                    if(unit === 'week' && this.statFrequency === 'week') {
                        // make sure we get beginning of week
                        startRange = startRange.week(startRange.week());
                    }
                }
                // set end range by +1 of whatever unit we are using
                const endRange = this.statFrequency === 'week' ? startRange.clone().week(startRange.week() + 1) : startRange.clone().set(this.statFrequency, startRange.get(this.statFrequency) + 1);

                const tsStats = await this.tsStatsRepo.findBy({
                    managerId: this.managerEntity.id,
                    granularity: this.statFrequency,
                    // make sure its inclusive!
                    _createdAt: Between(startRange.clone().subtract(1, 'second').toDate(), endRange.clone().add(1, 'second').toDate())
                });

                if(tsStats.length === 0) {
                    const statEntities: TimeSeriesStat[] = [];
                    for (const [k, v] of Object.entries(currentStats)) {
                        statEntities.push(new TimeSeriesStat({
                            metric: k,
                            value: v,
                            granularity: this.statFrequency,
                            manager: this.managerEntity,
                            createdAt: startRange,
                        }));
                    }
                    this.timeSeriesStatsEntities = statEntities;
                } else {
                    this.timeSeriesStatsEntities = tsStats;
                }

                for (const [k, v] of Object.entries(currentStats)) {
                    const matchedStat = this.timeSeriesStatsEntities.find(x => x.metric === k);
                    if (matchedStat !== undefined) {
                        currentStats[k] = matchedStat.value;
                    } else {
                        this.logger.warn(`Could not find time series stat matching '${k}' in the database, will default to 0`);
                        currentStats[k] = v;
                    }
                }
            }
        } catch (e) {
            this.logger.error(new ErrorWithCause('Failed to init frequency (time series) stats', {cause: e}));
        }
    }

    updateHistoricalStats(data: Partial<HistoricalStatsDisplay>) {
        for(const [k, v] of Object.entries(data)) {
            if(this.stats.historical[k] !== undefined && v !== undefined) {
                this.stats.historical[k] += v;
            }
            if(this.stats.timeSeries[k] !== undefined && v !== undefined) {
                this.stats.timeSeries[k] += v;
            }
        }
    }

    getHistoricalDisplayStats(): HistoricalStatsDisplay {
        return this.stats.historical;
    }

    async saveHistoricalStats() {
        if(this.totalStatsEntities !== undefined) {
            for(const [k, v] of Object.entries(this.stats.historical)) {
                const matchedStatIndex = this.totalStatsEntities.findIndex(x => x.metric === k);
                if(matchedStatIndex !== -1) {
                    this.totalStatsEntities[matchedStatIndex].value = v;
                } else {
                    this.logger.warn(`Could not find historical stat matching '${k}' in total stats??`);
                }

            }
            await this.totalStatsRepo.save(this.totalStatsEntities);
        }

        if(this.timeSeriesStatsEntities !== undefined) {
            for(const [k, v] of Object.entries(this.stats.timeSeries)) {
                const matchedStatIndex = this.timeSeriesStatsEntities.findIndex(x => x.metric === k);
                if(matchedStatIndex !== -1) {
                    this.timeSeriesStatsEntities[matchedStatIndex].value = v;
                } else {
                    this.logger.warn(`Could not find time series stat matching '${k}' in total stats??`);
                }

            }
            await this.tsStatsRepo.save(this.timeSeriesStatsEntities);
        }
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

    getCacheTotals() {
        return Object.values(this.stats.cache).reduce((acc, curr) => ({
            miss: acc.miss + curr.miss,
            req: acc.req + curr.requests,
        }), {miss: 0, req: 0});
    }

    async getStats() {
        const totals = this.getCacheTotals();
        const cacheKeys = Object.keys(this.stats.cache);
        const res = {
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
                        const diffData = acc[curr].requestTimestamps.reduce((accTimestampData, curr: number) => {
                            if(accTimestampData.last === 0) {
                                accTimestampData.last = curr;
                                return accTimestampData;
                            }
                            accTimestampData.diffs.push(curr - accTimestampData.last);
                            accTimestampData.last = curr;
                            return accTimestampData;
                        },{last: 0, diffs: [] as number[]});
                        const avgDiff = diffData.diffs.reduce((acc, curr) => acc + curr, 0) / diffData.diffs.length;

                        acc[curr].averageTimeBetweenHits = formatNumber(avgDiff/1000);
                    }

                    const {requestTimestamps, identifierRequestCount, ...rest} = acc[curr];
                    // @ts-ignore
                    acc[curr] = rest;

                    return acc;
                }, Promise.resolve({...this.stats.cache}))
            }
        }
        return res;
    }

    setLogger(logger: Logger) {
        this.logger = logger.child({labels: ['Resources']}, mergeArr);
    }

    async getActionedEventsBuilder(): Promise<SelectQueryBuilder<CMEvent>> {
        const eventRepo = this.database.getRepository(ActionedEventEntity);
        return eventRepo.createQueryBuilder("event")
            .leftJoinAndSelect('event.source', 'source')
            .leftJoinAndSelect('event.activity', 'activity')
            .leftJoinAndSelect('activity.subreddit', 'subreddit')
            .leftJoinAndSelect('activity.author', 'author')
            .leftJoinAndSelect('event.runResults', 'runResults')
            .leftJoinAndSelect('runResults._authorIs', 'rrAuthorIs')
            .leftJoinAndSelect('runResults._itemIs', 'rrItemIs')
            .leftJoinAndSelect('runResults.run', 'run')
            .leftJoinAndSelect('runResults.checkResults', 'checkResults')
            .leftJoinAndSelect('checkResults._authorIs', 'cAuthorIs')
            .leftJoinAndSelect('checkResults._itemIs', 'cItemIs')
            .leftJoinAndSelect('checkResults.ruleResults', 'ruleResults')
            .leftJoinAndSelect('ruleResults._authorIs', 'rAuthorIs')
            .leftJoinAndSelect('ruleResults._itemIs', 'rItemIs')
            .leftJoinAndSelect('checkResults.actionResults', 'actionResults')
            .leftJoinAndSelect('actionResults._authorIs', 'aAuthorIs')
            .leftJoinAndSelect('actionResults._itemIs', 'aItemIs')
            .andWhere('event.manager.id = :managerId', {managerId: this.managerEntity.id})
            .orderBy('event.processedAt', 'DESC')
    }

    // async getActionedEvents(): Promise<ActionedEventEntity[]> {
    //     const eventRepo = this.database.getRepository(ActionedEventEntity);
    //     const events = await eventRepo.find({
    //         where: {
    //             manager: {
    //                     id: this.managerEntity.id
    //             }
    //         },
    //         order: {
    //             // @ts-ignore
    //             processedAt: 'DESC'
    //         },
    //         relations: {
    //             source: true,
    //             activity: {
    //                 subreddit: true,
    //                 author: true
    //             },
    //             runResults: {
    //                 _authorIs: {
    //                     criteriaResults: true
    //                 },
    //                 _itemIs: {
    //                     criteriaResults: true
    //                 },
    //                 run: true,
    //                 checkResults: {
    //                     _authorIs: {
    //                         criteriaResults: true
    //                     },
    //                     _itemIs: {
    //                         criteriaResults: true
    //                     },
    //                     ruleResults: {
    //                         _authorIs: {
    //                             criteriaResults: true
    //                         },
    //                         _itemIs: {
    //                             criteriaResults: true
    //                         },
    //                     },
    //                     actionResults: {
    //                         _authorIs: {
    //                             criteriaResults: true
    //                         },
    //                         _itemIs: {
    //                             criteriaResults: true
    //                         },
    //                     }
    //                 }
    //             },
    //         }
    //     })
    //     return events;
    // }

    async getActivityLastSeenDate(value: SnoowrapActivity | string): Promise<Dayjs | undefined> {
        if(this.selfTTL !== false) {
            const id = typeof(value) === 'string' ? value : value.name;
            const hash = `activityLastSeen-${id}`;
            const lastSeenUnix = await this.cache.get(hash) as string | undefined | null;
            if(lastSeenUnix !== undefined && lastSeenUnix !== null) {
                return dayjs.unix(Number.parseInt(lastSeenUnix, 10));
            }
            return undefined;
        }
        return undefined;
    }

    async setActivityLastSeenDate(value: SnoowrapActivity | string, timestamp?: number): Promise<void> {
        if(this.selfTTL !== false) {
            const id = typeof(value) === 'string' ? value : value.name;
            const hash = `activityLastSeen-${id}`;
            this.cache.set(hash, timestamp ?? dayjs().unix(), {
                ttl: 86400 // store for 24 hours (seconds)
            });
        }
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
            throw new ErrorWithCause('Error while trying to fetch a cached Activity', {cause: err});
        }
    }

    // @ts-ignore
    public async setActivity(item: Submission | Comment, tryToFetch = true)
    {
        try {
            let hash = '';
            if (this.submissionTTL !== false && isSubmission(item)) {
                hash = `sub-${item.name}`;
                if (tryToFetch && item instanceof Submission) {
                    // @ts-ignore
                    const itemToCache = await item.fetch();
                    await this.cache.set(hash, itemToCache, {ttl: this.submissionTTL});
                    return itemToCache;
                } else {
                    // @ts-ignore
                    await this.cache.set(hash, item, {ttl: this.submissionTTL});
                    return item;
                }
            } else if (this.commentTTL !== false) {
                hash = `comm-${item.name}`;
                if (tryToFetch && item instanceof Comment) {
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
            return item;
        } catch (e) {
            throw new ErrorWithCause('Error occurred while trying to add Activity to cache', {cause: e});
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
    async getSubreddit(item: Submission | Comment | Subreddit | string, logger = this.logger) {
        let subName = '';
        if (typeof item === 'string') {
            subName = item;
        } else if (asSubreddit(item)) {
            subName = item.display_name;
        } else if (asSubmission(item) || asComment(item)) {
            subName = getActivitySubredditName(item);
        }
        try {
            let hash = '';
            if (this.subredditTTL !== false) {

                hash = `sub-${subName}`;
                await this.stats.cache.subreddit.identifierRequestCount.set(hash, (await this.stats.cache.subreddit.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
                this.stats.cache.subreddit.requestTimestamps.push(Date.now());
                this.stats.cache.subreddit.requests++;
                const cachedSubreddit = await this.cache.get(hash);
                if (cachedSubreddit !== undefined && cachedSubreddit !== null) {
                    logger.debug(`Cache Hit: Subreddit ${subName}`);
                    return new Subreddit(cachedSubreddit, this.client, false);
                }
                // @ts-ignore
                const subreddit = await (item instanceof Subreddit ? item : this.client.getSubreddit(subName)).fetch() as Subreddit;
                this.stats.cache.subreddit.miss++;
                // @ts-ignore
                await this.cache.set(hash, subreddit, {ttl: this.subredditTTL});
                // @ts-ignore
                return subreddit as Subreddit;
            } else {
                // @ts-ignore
                let subreddit = await (item instanceof Subreddit ? item : this.client.getSubreddit(subName)).fetch();

                return subreddit as Subreddit;
            }
        } catch (err: any) {
            this.logger.error('Error while trying to fetch a cached subreddit', err);
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

    async getAuthorModNotesByActivityAuthor(activity: Comment | Submission) {
        const author = activity.author instanceof RedditUser ? activity.author : getActivityAuthorName(activity.author);
        if (activity.subreddit.display_name !== this.subreddit.display_name) {
            throw new SimpleError(`Can only get Modnotes for current moderator subreddit, Activity is from ${activity.subreddit.display_name}`, {isSerious: false});
        }
        return this.getAuthorModNotes(author);
    }

    async getAuthorModNotes(val: RedditUser | string) {

        const authorName = typeof val === 'string' ? val : val.name;
        if (authorName === '[deleted]') {
            throw new SimpleError(`User is '[deleted]', cannot retrieve`, {isSerious: false});
        }
        const subredditName = this.subreddit.display_name

        const hash = `authorModNotes-${subredditName}-${authorName}`;

        if (this.modNotesTTL !== false) {
            const cachedModNoteData = await this.cache.get(hash) as ModNoteRaw[] | null | undefined;
            if (cachedModNoteData !== undefined && cachedModNoteData !== null) {
                this.logger.debug(`Cache Hit: Author ModNotes ${authorName} in ${subredditName}`);

                return cachedModNoteData.map(x => {
                    const note = new ModNote(x, this.client);
                    note.subreddit = this.subreddit;
                    if (val instanceof RedditUser) {
                        note.user = val;
                    }
                    return note;
                });
            }
        }

        const fetchedNotes = (await this.client.getModNotes(this.subreddit, val)).notes.map(x => {
            x.subreddit = this.subreddit;
            if (val instanceof RedditUser) {
                x.user = val;
            }
            return x;
        });

        if (this.modNotesTTL !== false) {
            // @ts-ignore
            await this.cache.set(hash, fetchedNotes, {ttl: this.modNotesTTL});
        }

        return fetchedNotes;
    }

    async addModNote(note: CreateModNoteData | ModNote): Promise<ModNote> {
        let data: CreateModNoteData;
        if (asCreateModNoteData(note)) {
            data = note;
        } else {
            data = {
                user: note.user,
                subreddit: this.subreddit,
                activity: note.note.actedOn as Submission | Comment | RedditUser | undefined,
                label: note.note.label,
                note: note.note.note ?? '',
            }
        }

        const newNote = await this.client.addModNote(data);

        if (this.modNotesTTL !== false) {
            const hash = `authorModNotes-${this.subreddit.display_name}-${data.user.name}`;
            const cachedModNoteData = await this.cache.get(hash) as ModNoteRaw[] | null | undefined;
            if (cachedModNoteData !== undefined && cachedModNoteData !== null) {
                this.logger.debug(`Adding new Note ${newNote.id} to Author ${data.user.name} Note cache`);
                await this.cache.set(hash, [newNote, ...cachedModNoteData], {ttl: this.modNotesTTL});
            }
        }

        return newNote;
    }

    // @ts-ignore
    async getAuthor(val: RedditUser | string) {
        const authorName = typeof val === 'string' ? val : val.name;
        if(authorName === '[deleted]') {
            throw new SimpleError(`User is '[deleted]', cannot retrieve`, {isSerious: false});
        }
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
        try {
            // @ts-ignore
            user = await user.fetch();

            if (this.authorTTL !== false) {
                // @ts-ignore
                await this.cache.set(hash, user, {ttl: this.authorTTL});
            }

            return user;
        } catch (err) {
            if(isStatusError(err) && err.statusCode === 404) {
                throw new SimpleError(`Reddit returned a 404 for User '${authorName}'. Likely this user is shadowbanned.`, {isSerious: false, code: 404});
            }
            throw new ErrorWithCause(`Could not retrieve User '${authorName}'`, {cause: err});
        }
    }

    async getAuthorActivities(user: RedditUser, options: ActivityWindowCriteria, customListing?: NamedListing): Promise<SnoowrapActivity[]> {

        const {post} = await this.getAuthorActivitiesWithFilter(user, options, customListing);
        return post;
    }

    async getAuthorActivitiesWithFilter(user: RedditUser, options: ActivityWindowCriteria, customListing?: NamedListing): Promise<FetchedActivitiesResult> {
        let listFuncName: string;
        let listFunc: ListingFunc;

        if(customListing !== undefined) {
            listFuncName = customListing.name;
            listFunc = customListing.func;
        } else {
            listFuncName = options.fetch ?? 'overview';
            switch(options.fetch) {
                case 'comment':
                    listFunc = (options?: object) => user.getComments(options);
                    break;
                case 'submission':
                    listFunc = (options?: object) => user.getSubmissions(options);
                    break;
                case 'overview':
                default:
                    listFunc = (options?: object) => user.getOverview(options);
            }
        }

        const criteriaWithDefaults = {
            chunkSize: 100,
            sort: 'new' as AuthorHistorySort,
            ...(cloneDeep(options)),
        }

        return await this.getActivities(user, criteriaWithDefaults, {func: listFunc, name: listFuncName});
    }

    async getAuthorComments(user: RedditUser, options: ActivityWindowCriteria): Promise<Comment[]> {
        return await this.getAuthorActivities(user, {...options, fetch: 'comment'}) as unknown as Promise<Comment[]>;
    }

    async getAuthorSubmissions(user: RedditUser, options: ActivityWindowCriteria): Promise<Submission[]> {
        return await this.getAuthorActivities(user, {
            ...options,
            fetch: 'submission'
        }) as unknown as Promise<Submission[]>;
    }

    async getActivities(user: RedditUser, options: ActivityWindowCriteria, listingData: NamedListing): Promise<FetchedActivitiesResult> {

        try {

            let pre: SnoowrapActivity[] = [];
            let post: SnoowrapActivity[] | undefined;
            let apiCount = 1;
            let preMaxTrigger: undefined | string;
            let rawCount: number = 0;
            let fromCache = false;

            const hashObj = cloneDeep(options);

            // don't include post filter when determining cache hash
            // because we can re-use the cache results from a 'pre' return to filter to post (no need to use api)
            if(hashObj.filterOn !== undefined) {
                delete hashObj.filterOn.post;
            }

            const userName = getActivityAuthorName(user);

            const hash = objectHash.sha1(hashObj);
            const cacheKey = `${userName}-${listingData.name}-${hash}`;

            if (this.authorTTL !== false) {
                if (this.useSubredditAuthorCache) {
                    hashObj.subreddit = this.subreddit;
                }

                this.stats.cache.author.requests++;
                await this.stats.cache.author.identifierRequestCount.set(userName, (await this.stats.cache.author.identifierRequestCount.wrap(userName, () => 0) as number) + 1);
                this.stats.cache.author.requestTimestamps.push(Date.now());

                const cacheVal = await this.cache.get(cacheKey);

                if(cacheVal === undefined || cacheVal === null) {
                    this.stats.cache.author.miss++;
                } else {
                    fromCache = true;
                    const {
                        pre: cachedPre,
                        rawCount: cachedRawCount,
                        apiCount: cachedApiCount,
                        preMaxTrigger: cachedPreMaxTrigger,
                    } = cacheVal as CachedFetchedActivitiesResult;

                    rawCount = cachedRawCount;
                    apiCount = cachedApiCount;
                    preMaxTrigger = cachedPreMaxTrigger !== undefined && cachedPreMaxTrigger !== null ? cachedPreMaxTrigger : undefined;

                    // convert cached activities into snoowrap activities
                    pre = cachedPre.map(x => {
                        const { author: authorName, subreddit: subredditName, ...rest } = x;
                        const author = new RedditUser({name: authorName }, this.client, false);
                        const subreddit = new Subreddit({display_name: subredditName as unknown as string}, this.client, false);
                        if(asSubmission(x)) {
                            const {comments, ...restSub} = rest as Submission;
                            const subData = {...restSub, author, subreddit};
                            if(rest.approved_by !== null && rest.approved_by !== undefined) {
                                const approvedBy = new RedditUser({name: rest.approved_by as unknown as string}, this.client, false);
                                subData.approved_by = approvedBy;
                            }
                            // we set as fetched since we have all(?) properties from json and have substituted relationships with proxies (author, subreddit)
                            // makes sure proxy doesn't fetch activity again when trying to access undefined properties later
                            const sub = new Submission(subData, this.client, true);
                            return sub;
                        } else if(asComment(x)) {
                            const {replies, ...restComm} = rest as Comment;
                            const commData = {
                                ...restComm,
                                author,
                                subreddit,
                                // see snoowrap Comment.js
                                // we are faking empty replies since we don't have "more" link, currently, to build a proper Listing
                                // and CM doesn't use comment replies at this point so this doesn't matter
                                replies: ''
                            };
                            // we set as fetched since we have all(?) properties from json and have substituted relationships with proxies (author, subreddit)
                            // makes sure proxy doesn't fetch activity again when trying to access undefined properties later
                            const com = new Comment(commData, this.client, true);
                            return com;
                        }
                        return x;
                    }) as SnoowrapActivity[];

                    //this.logger.debug(`${rawCount} Fetched (Saved ${apiCallCount} API Calls!) | Cached ${pre.length} from Pre${preMaxHit !== undefined ? ` (Hit Pre Max: ${preMaxHit})` : ''} | Cache Hit: ${userName}-${listingData.name} (Hash ${hash})`, {leaf: 'Activities Fetch'});
                }
            }

            if(!fromCache) {

                const {
                    chunkSize: cs = 100,
                    satisfyOn,
                    count,
                    duration,
                } = options;

                let satisfiedCount: number | undefined,
                    satisfiedPreCount: number | undefined,
                    satisfiedEndtime: Dayjs | undefined,
                    satisfiedPreEndtime: Dayjs | undefined,
                    chunkSize = Math.min(cs, 100),
                    satisfy = satisfyOn;

                satisfiedCount = count;

                // if count is less than max limit (100) go ahead and just get that many. may result in faster response time for low numbers
                if (satisfiedCount !== undefined) {
                    chunkSize = Math.min(chunkSize, satisfiedCount);
                }

                if (duration !== undefined) {
                    const endTime = dayjs();
                    satisfiedEndtime = endTime.subtract(duration.asMilliseconds(), 'milliseconds');
                }

                if (satisfiedCount === undefined && satisfiedEndtime === undefined) {
                    throw new Error('window value was not valid');
                } else if (satisfy === 'all' && !(satisfiedCount !== undefined && satisfiedEndtime !== undefined)) {
                    // even though 'all' was requested we don't have two criteria so its really 'any' logic
                    satisfy = 'any';
                }

                if(options.filterOn?.pre !== undefined) {
                    if(typeof options.filterOn?.pre.max === 'number') {
                        satisfiedPreCount = options.filterOn?.pre.max
                    } else {
                        const endTime = dayjs();
                        satisfiedPreEndtime = endTime.subtract(options.filterOn?.pre.max.asMilliseconds(), 'milliseconds');
                    }
                }

                let unFilteredItems: SnoowrapActivity[] | undefined;


                const { func: listingFunc } = listingData;


                let listing = await listingFunc(getAuthorHistoryAPIOptions(options));
                let hitEnd = false;
                let offset = chunkSize;
                while (!hitEnd) {

                    let countOk = false,
                        timeOk = false;

                    let listSlice = listing.slice(offset - chunkSize);
                    let preListSlice = await this.filterListingWithHistoryOptions(listSlice, user, options.filterOn?.pre);

                    // its more likely the time criteria is going to be hit before the count criteria
                    // so check this first
                    let truncatedItems: Array<Submission | Comment> = [];
                    if (satisfiedEndtime !== undefined) {
                        const [filteredSome, truncatedItems] = filterByTimeRequirement(satisfiedEndtime, preListSlice);

                        if (filteredSome) {
                            if (satisfy === 'any') {
                                // satisfied duration
                                pre = pre.concat(truncatedItems);
                                break;
                            }
                            timeOk = true;
                        }
                    }

                    if (satisfiedCount !== undefined && pre.length + preListSlice.length >= satisfiedCount) {
                        // satisfied count
                        if (satisfy === 'any') {
                            pre = pre.concat(preListSlice).slice(0, satisfiedCount);
                            break;
                        }
                        countOk = true;
                    }

                    // if we've satisfied everything take whichever is bigger
                    if (satisfy === 'all' && countOk && timeOk) {
                        if (satisfiedCount as number > pre.length + truncatedItems.length) {
                            pre = pre.concat(preListSlice).slice(0, satisfiedCount);
                        } else {
                            pre = pre.concat(truncatedItems);
                        }
                        break;
                    }

                    // if we got this far neither count nor time was satisfied (or both) so just add all items from listing and fetch more if possible
                    pre = pre.concat(preListSlice);

                    if(satisfiedPreEndtime !== undefined || satisfiedPreCount !== undefined) {
                        if(unFilteredItems === undefined) {
                            unFilteredItems = [];
                        }
                        // window has pre filtering, need to check if fallback max would be hit
                        if(satisfiedPreEndtime !== undefined) {
                            const [filteredSome, truncatedItems] = filterByTimeRequirement(satisfiedPreEndtime, listSlice);
                            if(filteredSome) {
                                unFilteredItems = unFilteredItems.concat(truncatedItems);
                                preMaxTrigger = (options.filterOn?.pre?.max as Duration).humanize();
                                break;
                            }
                        }
                        if(satisfiedPreCount !== undefined && unFilteredItems.length + listSlice.length >= satisfiedPreCount) {
                            preMaxTrigger = `${options.filterOn?.pre?.max} Items`;
                            unFilteredItems = unFilteredItems.concat(listSlice).slice(0, satisfiedPreCount)
                            break;
                        }
                        unFilteredItems = unFilteredItems.concat(listSlice);
                    }

                    hitEnd = listing.isFinished;

                    if (!hitEnd) {
                        apiCount++;
                        offset += chunkSize;
                        listing = await listing.fetchMore({amount: chunkSize, ...getAuthorHistoryAPIOptions(options)});
                    }
                }

                rawCount = unFilteredItems !== undefined ? unFilteredItems.length : listing.length;

                if(this.authorTTL !== false) {
                    this.cache.set(cacheKey, {pre: pre, rawCount, apiCount, preMaxTrigger}, {ttl: this.authorTTL})
                }
            }

            let itemCountAfterPost: number | undefined;
            if(options.filterOn?.post !== undefined) {
                post = await this.filterListingWithHistoryOptions(pre, user, options.filterOn?.post);
                itemCountAfterPost = post.length;
            }

            const listStats: string[] = [`${rawCount} Activities ${fromCache ? 'From Cache' : 'Fetched'} (${apiCount} API Calls${fromCache ? ' saved! ' : ''})`];
            listStats.push(`${pre.length} Met Window Range After Pre Filter${preMaxTrigger !== undefined ? `(Hit Pre Max: ${preMaxTrigger})`: ''}`);

            if(itemCountAfterPost !== undefined) {
                listStats.push(`${itemCountAfterPost} After Post Filter`)
            }

            if(fromCache) {
                listStats.push(`Cache Fingerprint: ${cacheKey}`)
            }

            this.logger.debug(listStats.join(' | '), {leaf: 'Activities Fetch'})

            return Promise.resolve({pre, post: post ?? pre, rawCount, apiCount, preMaxTrigger});
        } catch (err: any) {
            if(isStatusError(err)) {
                switch(err.statusCode) {
                    case 404:
                        throw new SimpleError('Reddit returned a 404 for user history. Likely this user is shadowbanned.', {isSerious: false});
                    case 403:
                        throw new MaybeSeriousErrorWithCause('Reddit returned a 403 for user history, likely this user is suspended.', {cause: err, isSerious: false});
                    default:
                        throw err;
                }

            } else {
                throw err;
            }
        }
    }

    async filterListingWithHistoryOptions(listing: SnoowrapActivity[], user: RedditUser, opts?: HistoryFiltersOptions): Promise<SnoowrapActivity[]> {
        if(opts === undefined) {
            return listing;
        }
        const {debug = false} = opts;

        let filteredListing = [...listing];
        if(filteredListing.length > 0 && opts.subreddits !== undefined) {
            const subredditTestOptions = debug ? {logger: undefined, includeIdentifier: true} : {logger: NoopLogger};
            if(opts.subreddits.include !== undefined) {
                filteredListing = await this.batchTestSubredditCriteria(filteredListing, opts.subreddits.include.map(x => x.criteria), user, subredditTestOptions);
            } else if(opts.subreddits.exclude !== undefined) {
                // TODO use excludeCondition correctly?
                filteredListing = await this.batchTestSubredditCriteria(filteredListing, opts.subreddits.exclude.map(x => x.criteria), user, {...subredditTestOptions, isInclude: false});
            }
        }
        if(filteredListing.length > 0 && (opts.submissionState !== undefined || opts.commentState !== undefined || opts.activityState !== undefined)) {
            const newFiltered = [];
            for(const activity of filteredListing) {
                let passes = true;
                if(asSubmission(activity) && opts.submissionState !== undefined) {
                    const [subPass, subPassType, filterResult] = await checkItemFilter(activity, opts.submissionState, this, {logger: debug ? this.logger : undefined});
                    passes = subPass;
                } else if(opts.commentState !== undefined) {
                   const [comPasses, comPassType, filterResult] = await checkItemFilter(activity, opts.commentState, this, {logger: debug ? this.logger : undefined});
                    passes = comPasses;
                } else if(opts.activityState !== undefined) {
                    const [actPasses, actPassType, filterResult] = await checkItemFilter(activity, opts.activityState, this, {logger: debug ? this.logger : undefined});
                    passes = actPasses;
                }
                if(passes) {
                    newFiltered.push(activity)
                }
            }
            filteredListing = newFiltered;
        }

        return filteredListing;
    }

    async getExternalResource(val: string, subredditArg?: Subreddit): Promise<{val: string, fromCache: boolean, response?: Response, hash?: string}> {
        const subreddit = subredditArg || this.subreddit;
        let cacheKey;
        const wikiContext = parseWikiContext(val);
        if (wikiContext !== undefined) {
            cacheKey = `${subreddit.display_name}-content-${wikiContext.wiki}${wikiContext.subreddit !== undefined ? `|${wikiContext.subreddit}` : ''}`;
        }
        const extUrl = wikiContext === undefined ? parseExternalUrl(val) : undefined;
        if (extUrl !== undefined) {
            cacheKey = extUrl;
        }

        if (cacheKey === undefined) {
            return {val, fromCache: false, hash: cacheKey};
        }

        // try to get cached value first
        if (this.wikiTTL !== false) {
            await this.stats.cache.content.identifierRequestCount.set(cacheKey, (await this.stats.cache.content.identifierRequestCount.wrap(cacheKey, () => 0) as number) + 1);
            this.stats.cache.content.requestTimestamps.push(Date.now());
            this.stats.cache.content.requests++;
            const cachedContent = await this.cache.get(cacheKey);
            if (cachedContent !== undefined && cachedContent !== null) {
                this.logger.debug(`Content Cache Hit: ${cacheKey}`);
                return {val: cachedContent as string, fromCache: true, hash: cacheKey};
            } else {
                this.stats.cache.content.miss++;
            }
        }

        let wikiContent: string;
        let response: Response | undefined;

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
                const [wikiContentVal, responseVal] = await fetchExternalResult(extUrl as string, this.logger);
                wikiContent = wikiContentVal;
                response = responseVal;
            } catch (err: any) {
                const msg = `Error occurred while trying to fetch the url ${extUrl}`;
                this.logger.error(msg, err);
                throw new LoggedError(msg);
            }
        }

        return {val: wikiContent, fromCache: false, response, hash: cacheKey};
    }

    async getContent(val: string, subredditArg?: Subreddit): Promise<string> {
        const {val: wikiContent, fromCache, hash} = await this.getExternalResource(val, subredditArg);

        if (!fromCache && hash !== undefined && this.wikiTTL !== false) {
            this.cache.set(hash, wikiContent, {ttl: this.wikiTTL});
        }

        return wikiContent;
    }

    /**
     * Convenience method for using getContent and SnoowrapUtils@renderContent in one method
     * */
    async renderContent(contentStr: string, data: SnoowrapActivity, ruleResults: RuleResultEntity[] = [], usernotes?: UserNotes) {
        const content = await this.getContent(contentStr);
        return await renderContent(content, data, ruleResults, usernotes ?? this.userNotes);
    }

    async getConfigFragment<T>(includesData: IncludesData, validateFunc?: ConfigFragmentValidationFunc): Promise<T> {

        const {
            path,
            ttl = this.wikiTTL,
        } = includesData;

        const {val: configStr, fromCache, hash, response} = await this.getExternalResource(path);

        const [format, configObj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(configStr);
        if (configObj === undefined) {
            //this.logger.error(`Could not parse includes URL of '${configStr}' contents as JSON or YAML.`);
            this.logger.error(yamlErr);
            this.logger.debug(jsonErr);
            throw new ConfigParseError(`Could not parse includes URL of '${configStr}' contents as JSON or YAML.`)
        }

        // if its from cache then we know the data is valid
        if(fromCache) {
            this.logger.verbose(`Got Config Fragment ${path} from cache`);
            return configObj.toJS() as unknown as T;
        }

        const rawData = configObj.toJS();
        let validatedData: T;
        // otherwise now we want to validate it if a function is present
        if(validateFunc !== undefined) {
            try {
               validateFunc(configObj.toJS(), fromCache);
               validatedData = rawData as unknown as T;
            } catch (e) {
                throw e;
            }
        } else {
            validatedData = rawData as unknown as T;
        }

        let ttlVal: number | false = this.wikiTTL;
        // never cache
        if(ttl === false) {
            return validatedData;
        } else if(typeof ttl === 'number') {
            ttlVal = ttl;
        } else if(ttl === true) {
            // cache forever
            ttlVal = 0;
        } else if(ttl === 'response') {
            // try to get cache time from response headers, if they exist
            // otherwise fallback to wiki ttl

            if(response === undefined) {
                ttlVal = this.wikiTTL;
            } else {
                const cc = response.headers.get('cache-control');
                const ex = response.headers.get('expires');
                if(cc !== null) {
                    // response doesn't want to be stored :(
                    if(null !== cc.match('/no-(cache|store)/i')) {
                        return validatedData;
                    }
                    const matches = cc.match(/max-age=(\d+)/);
                    if(null === matches) {
                        // huh? why include max-age but no value?
                        ttlVal = this.wikiTTL;
                    } else {
                        ttlVal = parseInt(matches[1], 10);
                    }
                } else if(ex !== null) {
                    const expDate = dayjs(ex);
                    if(dayjs.isDayjs(expDate) && expDate.isValid()) {
                        const seconds = expDate.diff(dayjs(), 'second');
                        if(seconds < 0) {
                            // expiration is older than now?? don't cache
                            return validatedData;
                        }
                        ttlVal = seconds;
                    }
                } else {
                    // couldn't get a cache header, fallback
                    ttlVal = this.wikiTTL;
                }
            }
        }

        if (ttlVal !== false) {
            this.cache.set(hash as string, configStr, {ttl: ttlVal});
        }

        return validatedData;
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

    // isInclude = true, logger: Logger = this.logger
    async batchTestSubredditCriteria(items: SnoowrapActivity[], states: (SubredditCriteria | StrongSubredditCriteria)[], author: RedditUser, options?: {logger?: Logger, isInclude?: boolean, includeIdentifier?: boolean}): Promise<(Comment | Submission)[]> {
        const {
            logger = this.logger,
            isInclude = true,
            includeIdentifier = false,
        } = options || {};

        let passedItems: (Comment | Submission)[] = [];
        let unpassedItems: (Comment | Submission)[] = [];

        const {nameOnly =  [], full = []} = states.reduce((acc: {nameOnly: (SubredditCriteria | StrongSubredditCriteria)[], full: (SubredditCriteria | StrongSubredditCriteria)[]}, curr) => {
            if(subredditStateIsNameOnly(curr)) {
                return {...acc, nameOnly: acc.nameOnly.concat(curr)};
            }
            return {...acc, full: acc.full.concat(curr)};
        }, {nameOnly: [], full: []});

        const derivedLogger = (item: SnoowrapActivity) => {
            if(!includeIdentifier) {
                return logger;
            }
            return logger.child({labels: `${asSubmission(item) ? 'SUB' : 'COM'} ${item.id}`}, mergeArr);
        }

        if(nameOnly.length === 0) {
            unpassedItems = items;
        } else {
            for(const item of items) {
                const subName = getActivitySubredditName(item);
                let matched = false;
                for(const state of nameOnly) {
                    if(await this.isSubreddit({display_name: subName} as Subreddit, state, author, derivedLogger(item))) {
                        matched = true;
                        break;
                    }
                }
                if(matched) {
                    if(isInclude) {
                        passedItems.push(item);
                    } else {
                        unpassedItems.push(item);
                    }
                } else if(!isInclude) {
                    passedItems.push(item);
                } else {
                    unpassedItems.push(item);
                }
            }
        }

        if(unpassedItems.length > 0 && full.length > 0) {
            await this.cacheSubreddits(unpassedItems.map(x => x.subreddit));
            for(const item of unpassedItems) {
                let matched = false;
                for(const state of full) {
                    const logger = derivedLogger(item);
                    if(await this.isSubreddit(await this.getSubreddit(item, logger), state, author, logger)) {
                        passedItems.push(item);
                        break;
                    }
                }
                if(matched) {
                    if(isInclude) {
                        passedItems.push(item);
                    }
                } else if(!isInclude) {
                    passedItems.push(item);
                }
            }
        }

        return passedItems;
    }

    async testSubredditCriteria(item: (Comment | Submission), state: SubredditCriteria | StrongSubredditCriteria, author: RedditUser) {
        if(Object.keys(state).length === 0) {
            return true;
        }
        // optimize for name-only criteria checks
        // -- we don't need to store cache results for this since we know subreddit name is always available from item (no request required)
        if(subredditStateIsNameOnly(state)) {
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

    async testAuthorCriteria(item: (Comment | Submission), authorOptsObj: NamedCriteria<AuthorCriteria>, include = true): Promise<FilterCriteriaResult<AuthorCriteria>> {
        const {criteria: authorOpts} = authorOptsObj;

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
                cachedAuthorTest.criteria = cloneDeep(authorOptsObj);
                await this.cache.set(hash, cachedAuthorTest, {ttl: this.filterCriteriaTTL});
                return cachedAuthorTest;
            }
        }

        const res = await this.isAuthor(item, authorOpts, include);
        res.criteria = cloneDeep(authorOptsObj);
        return res;
    }

    async testItemCriteria(i: (Comment | Submission), activityStateObj: NamedCriteria<TypedActivityState>, logger: Logger, include = true, source?: ActivitySource): Promise<FilterCriteriaResult<TypedActivityState>> {
        const {criteria: activityState} = activityStateObj;
        if(Object.keys(activityState).length === 0) {
            return {
                behavior: include ? 'include' : 'exclude',
                criteria: cloneDeep(activityStateObj),
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
                runtimeRes = await this.isItem(item, {dispatched, source: stateSource}, logger, include, source);
                if(!runtimeRes.passed) {
                    // if dispatched does not pass can return early and avoid testing the rest of the item
                    const [propResultsMap, definedStateCriteria] = generateItemFilterHelpers(rest, include);
                    if(dispatched !== undefined) {
                        propResultsMap.dispatched = runtimeRes.propertyResults.find(x => x.property === 'dispatched');
                    }
                    if(stateSource !== undefined) {
                        propResultsMap.source = runtimeRes.propertyResults.find(x => x.property === 'source');
                    }

                    return {
                        behavior: include ? 'include' : 'exclude',
                        criteria: cloneDeep(activityStateObj),
                        propertyResults: Object.values(propResultsMap),
                        passed: false
                    }
                }
            }

            try {
                // only cache non-runtime state and results
                const hash = `itemCrit-${item.name}-${objectHash.sha1({...state, include})}`;
                await this.stats.cache.itemCrit.identifierRequestCount.set(hash, (await this.stats.cache.itemCrit.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
                this.stats.cache.itemCrit.requestTimestamps.push(Date.now());
                this.stats.cache.itemCrit.requests++;
                let itemResult = await this.cache.get(hash) as FilterCriteriaResult<TypedActivityState> | undefined | null;
                if (itemResult !== undefined && itemResult !== null) {
                    logger.debug(`Cache Hit: Item Check on ${item.name} (Hash ${hash})`);
                    //return cachedItem as boolean;
                } else {
                    itemResult = await this.isItem(item, state, logger, include);
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
                itemResult.criteria = cloneDeep(activityStateObj);
                return itemResult;
            } catch (err: any) {
                if (err.logged !== true) {
                    this.logger.error('Error occurred while testing item criteria', err);
                }
                throw err;
            }
        }

        const res = await this.isItem(i, activityState, logger, include, source);
        res.criteria = cloneDeep(activityStateObj);
        return res;
    }

    async isSubreddit (subreddit: Subreddit, stateCriteriaRaw: SubredditCriteria | StrongSubredditCriteria, author: RedditUser, logger: Logger) {
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

    async isItem (item: Submission | Comment, stateCriteria: TypedActivityState, logger: Logger, include: boolean, source?: ActivitySource): Promise<FilterCriteriaResult<(SubmissionState & CommentState)>> {

        //const definedStateCriteria = (removeUndefinedKeys(stateCriteria) as RequiredItemCrit);

        const [propResultsMap, definedStateCriteria] = generateItemFilterHelpers(stateCriteria, include);

        const log = logger.child({leaf: 'Item Check'}, mergeArr);

        if(Object.keys(stateCriteria).length === 0) {
            return {
                behavior: include ? 'include' : 'exclude',
                criteria: {criteria: stateCriteria},
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
                        propResultsMap.dispatched!.passed = criteriaPassWithIncludeBehavior(found === itemOptVal || typeof found === 'string', include);
                        propResultsMap.dispatched!.found = found;
                        propResultsMap.dispatched!.reason = reason;
                        break;
                    case 'source':
                        if(source === undefined) {
                            propResultsMap.source!.passed = !include;
                            propResultsMap.source!.found = 'Not From Source';
                            propResultsMap.source!.reason = 'Activity was not retrieved from a source (may be from cache)';
                            break;
                        } else {
                            propResultsMap.source!.found = source;

                            const requestedSourcesVal: string[] = !Array.isArray(itemOptVal) ? [itemOptVal] as string[] : itemOptVal as string[];
                            const requestedSources = requestedSourcesVal.map(x => strToActivitySource(x).toLowerCase());

                            propResultsMap.source!.passed = criteriaPassWithIncludeBehavior(requestedSources.some(x => source.toLowerCase().trim() === x.toLowerCase().trim()), include);
                            break;
                        }
                    case 'score':
                        const scoreCompare = parseGenericValueComparison(itemOptVal as string);
                        propResultsMap.score!.passed = criteriaPassWithIncludeBehavior(comparisonTextOp(item.score, scoreCompare.operator, scoreCompare.value), include);
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

                        const reportSummaryParts: string[] = [];

                        let reports: ActivityReport[] = [];

                        if(item.num_reports > 0) {
                            reports = await this.database.getRepository(ActivityReport).createQueryBuilder('report')
                                .select('report')
                                .where({activityId: item.name})
                                .getMany();
                        }

                        const reportCompare = parseReportComparison(itemOptVal as string);

                        let reportType = reportCompare.reportType ?? 'total';

                        let validReports = reports;

                        if(reportCompare.reportType === 'user') {
                            validReports = validReports.filter(x => x.type === 'user');
                        } else if(reportCompare.reportType === 'mod') {
                            validReports = validReports.filter(x => x.type === 'mod');
                        }

                        if(reportCompare.reasonRegex !== undefined) {
                            reportSummaryParts.push(`containing reason matching ${reportCompare.reasonMatch}`);
                            validReports = validReports.filter(x => reportCompare.reasonRegex?.test(x.reason));
                        }
                        if(reportCompare.durationText !== undefined) {
                            reportSummaryParts.push(`within ${reportCompare.durationText}`);
                            const earliestDate = dayjs().subtract(reportCompare.duration as Duration);
                            validReports = validReports.filter(x => x.createdAt.isSameOrAfter(earliestDate));
                        }

                        let reportNum = validReports.length;

                        reportSummaryParts.unshift(`${reportNum} ${reportType} reports`);

                        propResultsMap.reports!.found = reportSummaryParts.join(' ');
                        propResultsMap.reports!.passed = criteriaPassWithIncludeBehavior(comparisonTextOp(reportNum, reportCompare.operator, reportCompare.value), include);
                        break;
                    case 'removed':

                        const removed = activityIsRemoved(item);

                        if(typeof itemOptVal === 'boolean') {
                            propResultsMap.removed!.passed = criteriaPassWithIncludeBehavior(removed === itemOptVal, include);
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
                        propResultsMap.deleted!.passed = criteriaPassWithIncludeBehavior(deleted === itemOptVal, include);
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
                        propResultsMap.filtered!.passed = criteriaPassWithIncludeBehavior(filtered === itemOptVal, include);
                        propResultsMap.filtered!.found = filtered;
                        break;
                    case 'age':
                        const created = dayjs.unix(await item.created);
                        const ageTest = compareDurationValue(parseDurationComparison(itemOptVal as string), created);
                        propResultsMap.age!.passed = criteriaPassWithIncludeBehavior(ageTest, include);
                        propResultsMap.age!.found = created.format('MMMM D, YYYY h:mm A Z');
                        break;
                    case 'title':
                        if(asComment(item)) {
                            const titleWarn ='`title` is not allowed in `itemIs` criteria when the main Activity is a Comment';
                            log.debug(titleWarn);
                            propResultsMap.title!.passed = true;
                            propResultsMap.title!.reason = titleWarn;
                            break;
                        }

                        propResultsMap.title!.found = item.title;

                        try {
                            const [titlePass, reg] = testMaybeStringRegex(itemOptVal as string, item.title);
                            propResultsMap.title!.passed = criteriaPassWithIncludeBehavior(titlePass, include);
                        } catch (err: any) {
                            propResultsMap.title!.passed = false;
                            propResultsMap.title!.reason = err.message;
                        }
                        break;
                    case 'isRedditMediaDomain':
                        if(asComment(item)) {
                            const mediaWarn = '`isRedditMediaDomain` is not allowed in `itemIs` criteria when the main Activity is a Comment';
                            log.debug(mediaWarn);
                            propResultsMap.isRedditMediaDomain!.passed = true;
                            propResultsMap.isRedditMediaDomain!.reason = mediaWarn;
                            break;
                        }

                        propResultsMap.isRedditMediaDomain!.found = item.is_reddit_media_domain;
                        propResultsMap.isRedditMediaDomain!.passed = criteriaPassWithIncludeBehavior(item.is_reddit_media_domain === itemOptVal, include);
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
                        propResultsMap[k]!.passed = criteriaPassWithIncludeBehavior(propResultsMap[k]!.found === itemOptVal, include);
                        break;
                    case 'op':
                        if(asSubmission(item)) {
                            const opWarn = `On a Submission the 'op' property will always be true. Did you mean to use this on a comment instead?`;
                            log.debug(opWarn);
                            propResultsMap.op!.passed = true;
                            propResultsMap.op!.reason = opWarn;
                            break;
                        }
                        propResultsMap.op!.found = (item as Comment).is_submitter;
                        propResultsMap.op!.passed = criteriaPassWithIncludeBehavior(propResultsMap.op!.found === itemOptVal, include);
                        break;
                    case 'depth':
                        if(asSubmission(item)) {
                            const depthWarn = `Cannot test for 'depth' on a Submission`;
                            log.debug(depthWarn);
                            propResultsMap.depth!.passed = true;
                            propResultsMap.depth!.reason = depthWarn;
                            break;
                        }
                        const depthCompare = parseGenericValueComparison(itemOptVal as string);

                        const depth = (item as Comment).depth;
                        propResultsMap.depth!.found = depth;
                        propResultsMap.depth!.passed = criteriaPassWithIncludeBehavior(comparisonTextOp(depth, depthCompare.operator, depthCompare.value), include);
                        break;
                    case 'upvoteRatio':
                        if(asSubmission(item)) {

                            let compareStr = typeof itemOptVal === 'number' ? `>= ${itemOptVal}` : itemOptVal as string;
                            const ratioCompare = parseGenericValueComparison(compareStr);

                            const ratio = item.upvote_ratio * 100;
                            propResultsMap.upvoteRatio!.found = ratio;
                            propResultsMap.upvoteRatio!.passed = criteriaPassWithIncludeBehavior(comparisonTextOp(ratio, ratioCompare.operator, ratioCompare.value), include);;
                            break;
                        } else {
                            const ratioCommWarn = `Cannot test for 'upvoteRatio' on a Comment`;
                            log.debug(ratioCommWarn);
                            propResultsMap.depth!.passed = true;
                            propResultsMap.depth!.reason = ratioCommWarn;
                            break;
                        }
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
                                    propResultsMap[k]!.passed = criteriaPassWithIncludeBehavior(propertyValue !== undefined && propertyValue !== null && propertyValue !== '', include);
                                } else {
                                    propResultsMap[k]!.passed = criteriaPassWithIncludeBehavior(propertyValue === undefined || propertyValue === null || propertyValue === '', include);
                                }
                            } else if (propertyValue === undefined || propertyValue === null || propertyValue === '') {
                                // if crit is not a boolean but property is "empty" then it'll never pass anyway
                                propResultsMap[k]!.passed = !include;
                            } else {
                                const expectedValues = typeof itemOptVal === 'string' ? [itemOptVal] : (itemOptVal as string[]);
                                propResultsMap[k]!.passed = criteriaPassWithIncludeBehavior(expectedValues.some(x => x.trim().toLowerCase() === propertyValue?.trim().toLowerCase()), include);
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
                            propResultsMap[k]!.passed = criteriaPassWithIncludeBehavior(val === itemOptVal, include);
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
            behavior: include ? 'include' : 'exclude',
            criteria: {criteria: cloneDeep(stateCriteria)},
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
                    } else if(asModNoteCriteria(x) || asModLogCriteria(x)) {
                        return modActionCriteriaSummary(x);
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

        const keys = Object.keys(propResultsMap) as (keyof AuthorCriteria)[]
        let orderedKeys: (keyof AuthorCriteria)[] = [];

        // push existing keys that should be ordered to the front of the list
        for(const oProp of orderedAuthorCriteriaProps) {
            if(keys.includes(oProp)) {
                orderedKeys.push(oProp);
            }
        }

        // then add any keys not included as ordered but that exist onto the end of the list
        // this way when we iterate all properties of the criteria we test all props that (probably) don't require API calls first
        orderedKeys = orderedKeys.concat(keys.filter(x => !orderedKeys.includes(x)));

            try {
                const authorName = getActivityAuthorName(item.author);

                let shouldContinue = true;
                for (const k of orderedKeys) {

                    if(propResultsMap.shadowBanned !== undefined && propResultsMap.shadowBanned!.found === true) {
                        // if we've determined the user is shadowbanned we can't get any info about them anyways so end criteria testing early
                        break;
                    }

                    // none of the criteria below are returned if the user is suspended
                    switch(k) {
                        case 'age':
                        case 'linkKarma':
                        case 'commentKarma':
                        case 'verified':
                        case 'description':
                            // @ts-ignore
                            if((await user()).is_suspended) {
                                propResultsMap[k]!.passed = false;
                                propResultsMap[k]!.reason = 'User is suspended';
                                shouldContinue = false;
                                break;
                            }
                    }

                    if(!shouldContinue) {
                        break;
                    }

                    const authorOptVal = definedAuthorOpts[k];

                    switch (k) {
                        case 'shadowBanned':

                            const isShadowBannedTest = async () => {
                                try {
                                    // @ts-ignore
                                    await user();
                                    return false;
                                } catch (err: any) {
                                    // see this.getAuthor() catch block
                                    if('code' in err && err.code === 404) {
                                        return true
                                    }
                                    throw err;
                                }
                            }

                            propResultsMap.shadowBanned!.found = await isShadowBannedTest();
                            const shadowPassed = (propResultsMap.shadowBanned!.found && authorOptVal === true) || (!propResultsMap.shadowBanned!.found && authorOptVal === false);
                            propResultsMap.shadowBanned!.passed = criteriaPassWithIncludeBehavior(shadowPassed, include);
                            if(propResultsMap.shadowBanned!.passed) {
                                shouldContinue = false;
                            }
                            break;
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
                            propResultsMap.name!.passed = criteriaPassWithIncludeBehavior(authResult, include);
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

                            propResultsMap.flairCssClass!.passed = criteriaPassWithIncludeBehavior(cssResult, include);
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
                            propResultsMap.flairText!.passed = criteriaPassWithIncludeBehavior(textResult, include);
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

                            propResultsMap.flairTemplate!.passed = criteriaPassWithIncludeBehavior(templateResult, include);
                            if (!propResultsMap.flairTemplate!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'isMod':
                            const mods: RedditUser[] = await this.getSubredditModerators(item.subreddit);
                            const isModerator = mods.some(x => x.name === authorName) || authorName.toLowerCase() === 'automoderator';
                            const modMatch = authorOptVal === isModerator;
                            propResultsMap.isMod!.found = isModerator;
                            propResultsMap.isMod!.passed = criteriaPassWithIncludeBehavior(modMatch, include);
                            if (!propResultsMap.isMod!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'isContributor':
                            const contributors: RedditUser[] = await this.getSubredditContributors();
                            const isContributor= contributors.some(x => x.name === authorName);
                            const contributorMatch = authorOptVal === isContributor;
                            propResultsMap.isContributor!.found = isContributor;
                            propResultsMap.isContributor!.passed = criteriaPassWithIncludeBehavior(contributorMatch, include);
                            if (!propResultsMap.isContributor!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'age':
                            // @ts-ignore
                            const authorAge = dayjs.unix((await user()).created);
                            const ageTest = compareDurationValue(parseDurationComparison(await authorOpts.age as string), authorAge);
                            propResultsMap.age!.found = authorAge.fromNow(true);
                            propResultsMap.age!.passed = criteriaPassWithIncludeBehavior(ageTest, include);
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
                            propResultsMap.linkKarma!.passed = criteriaPassWithIncludeBehavior(lkMatch, include);
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
                            propResultsMap.commentKarma!.passed = criteriaPassWithIncludeBehavior(ckMatch, include);
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
                            propResultsMap.totalKarma!.passed = criteriaPassWithIncludeBehavior(tkMatch, include);
                            if (!propResultsMap.totalKarma!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'verified':
                            // @ts-ignore
                            const verified = (await user()).has_verified_mail;
                            const vMatch = verified === authorOpts.verified as boolean;
                            propResultsMap.verified!.found = verified;
                            propResultsMap.verified!.passed = criteriaPassWithIncludeBehavior(vMatch, include);
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
                            propResultsMap.description!.passed = criteriaPassWithIncludeBehavior(passed, include);
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
                                        duration,
                                        extra = ''
                                    } = parseGenericValueOrPercentComparison(count);
                                    const cutoffDate = duration === undefined ? undefined : dayjs().subtract(duration);
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
                                            if (isPercent) {
                                                throw new SimpleError(`When comparing UserNotes with 'consecutive' search 'count' cannot be a percentage. Given: ${count}`);
                                            }

                                            let orderedNotes = cutoffDate === undefined ? notes : notes.filter(x => x.time.isSameOrAfter(cutoffDate));
                                            if (order === 'descending') {
                                                orderedNotes = [...notes];
                                                orderedNotes.reverse();
                                            }
                                            let currCount = 0;
                                            let maxCount = 0;
                                            for (const note of orderedNotes) {
                                                if (note.noteType === type) {
                                                    currCount++;
                                                    maxCount = Math.max(maxCount, currCount);
                                                } else {
                                                    currCount = 0;
                                                }
                                            }
                                            foundNoteResult.push(`Found ${currCount} ${type} consecutively`);
                                            if (comparisonTextOp(currCount, operator, value)) {
                                                return true;
                                            }
                                            break;
                                        case 'total':
                                            const filteredNotes = notes.filter(x => x.noteType === type && cutoffDate === undefined || (x.time.isSameOrAfter(cutoffDate)));
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
                            propResultsMap.userNotes!.passed = criteriaPassWithIncludeBehavior(noteResult, include);
                            if (!propResultsMap.userNotes!.passed) {
                                shouldContinue = false;
                            }
                            break;
                        case 'modActions':
                            const modActions = await this.getAuthorModNotesByActivityAuthor(item);
                            // TODO convert these prior to running filter so we don't have to do it every time
                            const actionCriterias = authorOptVal as (ModNoteCriteria | ModLogCriteria)[];
                            let actionResult: string[] = [];

                            const actionsPass = () => {

                                for (const actionCriteria of actionCriterias) {

                                    const {search = 'current', count = '>= 1'} = actionCriteria;


                                    const {
                                        value,
                                        operator,
                                        isPercent,
                                        duration,
                                        extra = ''
                                    } = parseGenericValueOrPercentComparison(count);
                                    const cutoffDate = duration === undefined ? undefined : dayjs().subtract(duration);

                                    let actionsToUse: ModNote[] = [];
                                    if(asModNoteCriteria(actionCriteria)) {
                                        actionsToUse = actionsToUse.filter(x => x.type === 'NOTE');
                                    } else {
                                        actionsToUse = modActions;
                                    }

                                    if(search === 'current' && actionsToUse.length > 0) {
                                        actionsToUse = [actionsToUse[0]];
                                    }

                                    let validActions: ModNote[] = [];
                                    if (asModLogCriteria(actionCriteria)) {
                                        const fullCrit = toFullModLogCriteria(actionCriteria);
                                        const fullCritEntries = Object.entries(fullCrit);
                                        validActions = actionsToUse.filter(x => {

                                            // filter out any notes that occur before time range
                                            if(cutoffDate !== undefined && x.createdAt.isBefore(cutoffDate)) {
                                                return false;
                                            }

                                            for (const [k, v] of fullCritEntries) {
                                                const key = k.toLocaleLowerCase();
                                                if (['count', 'search'].includes(key)) {
                                                    continue;
                                                }
                                                switch (key) {
                                                    case 'type':
                                                        if (!v.includes((x.type as ModActionType))) {
                                                            return false
                                                        }
                                                        break;
                                                    case 'activitytype':
                                                        const anyMatch = v.some((a: ActivityType) => {
                                                            switch (a) {
                                                                case 'submission':
                                                                    if (x.action.actedOn instanceof Submission) {
                                                                        return true;
                                                                    }
                                                                    break;
                                                                case 'comment':
                                                                    if (x.action.actedOn instanceof Comment) {
                                                                        return true;
                                                                    }
                                                                    break;
                                                            }
                                                        });
                                                        if (!anyMatch) {
                                                            return false;
                                                        }
                                                        break;
                                                    case 'description':
                                                    case 'action':
                                                    case 'details':
                                                        const actionPropVal = x.action[key] as string;
                                                        if (actionPropVal === undefined) {
                                                            return false;
                                                        }
                                                        const anyPropMatch = v.some((y: RegExp) => y.test(actionPropVal));
                                                        if (!anyPropMatch) {
                                                            return false;
                                                        }
                                                } // case end

                                            } // for each end

                                            return true;
                                        }); // filter end
                                    } else if(asModNoteCriteria(actionCriteria)) {
                                        const fullCrit = toFullModNoteCriteria(actionCriteria as ModNoteCriteria);
                                        const fullCritEntries = Object.entries(fullCrit);
                                        validActions = actionsToUse.filter(x => {

                                            // filter out any notes that occur before time range
                                            if(cutoffDate !== undefined && x.createdAt.isBefore(cutoffDate)) {
                                                return false;
                                            }

                                            for (const [k, v] of fullCritEntries) {
                                                const key = k.toLocaleLowerCase();
                                                if (['count', 'search'].includes(key)) {
                                                    continue;
                                                }
                                                switch (key) {
                                                    case 'notetype':
                                                        if (!v.map((x: ModUserNoteLabel) => x.toUpperCase()).includes((x.note.label as ModUserNoteLabel))) {
                                                            return false
                                                        }
                                                        break;
                                                    case 'note':
                                                        const actionPropVal = x.note.note;
                                                        if (actionPropVal === undefined) {
                                                            return false;
                                                        }
                                                        const anyPropMatch = v.some((y: RegExp) => y.test(actionPropVal));
                                                        if (!anyPropMatch) {
                                                            return false;
                                                        }
                                                        break;
                                                    case 'activitytype':
                                                        const anyMatch = v.some((a: ActivityType) => {
                                                            switch (a) {
                                                                case 'submission':
                                                                    if (x.action.actedOn instanceof Submission) {
                                                                        return true;
                                                                    }
                                                                    break;
                                                                case 'comment':
                                                                    if (x.action.actedOn instanceof Comment) {
                                                                        return true;
                                                                    }
                                                                    break;
                                                            }
                                                        });
                                                        if (!anyMatch) {
                                                            return false;
                                                        }
                                                        break;
                                                } // case end

                                            } // for each end

                                            return true;
                                        }); // filter end
                                    } else {
                                        throw new SimpleError(`Could not determine if a modActions criteria was for Mod Log or Mod Note. Given: ${JSON.stringify(actionCriteria)}`);
                                    }

                                    switch (search) {
                                        case 'current':
                                            if (validActions.length === 0) {
                                                actionResult.push('No Mod Actions present');
                                            } else {
                                                actionResult.push('Current Action matches criteria');
                                                return true;
                                            }
                                            break;
                                        case 'consecutive':
                                            if (isPercent) {
                                                throw new SimpleError(`When comparing Mod Actions with 'search: consecutive' the 'count' value cannot be a percentage. Given: ${count}`);
                                            }
                                            const validActionIds = validActions.map(x => x.id);
                                            const order = extra.includes('asc') ? 'ascending' : 'descending';
                                            let orderedActions = actionsToUse;
                                            if(order === 'descending') {
                                                orderedActions = [...actionsToUse];
                                                orderedActions.reverse();
                                            }
                                            let currCount = 0;
                                            let maxCount = 0;
                                            for(const action of orderedActions) {
                                                if(validActionIds.includes(action.id)) {
                                                    currCount++;
                                                    maxCount = Math.max(maxCount, currCount);
                                                } else {
                                                    currCount = 0;
                                                }
                                            }
                                            actionResult.push(`Found maximum of ${maxCount} consecutive Mod Actions that matched criteria`);
                                            if (comparisonTextOp(currCount, operator, value)) {
                                                return true;
                                            }
                                            break;
                                        case 'total':
                                            if (isPercent) {
                                                // avoid divide by zero
                                                const percent = notes.length === 0 ? 0 : validActions.length / actionsToUse.length;
                                                actionResult.push(`${formatNumber(percent)}% of ${actionsToUse.length} matched criteria`);
                                                if (comparisonTextOp(percent, operator, value / 100)) {
                                                    return true;
                                                }
                                            } else {
                                                actionResult.push(`${validActions.length} matched criteria`);
                                                if (comparisonTextOp(validActions.length, operator, value)) {
                                                    return true;
                                                }
                                            }
                                    }
                                } // criteria for loop ends
                                return false;
                            }
                            const actionsResult = actionsPass();
                            propResultsMap.modActions!.found = actionResult.join(' | ');
                            propResultsMap.modActions!.passed = criteriaPassWithIncludeBehavior(actionsResult, include);
                            if (!propResultsMap.modActions!.passed) {
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
                    throw new SimpleError('Reddit returned a 404 while trying to retrieve User profile. It is likely this user is shadowbanned.', {isSerious: false, code: 404});
                } else {
                    throw err;
                }
            }

        // gather values and determine overall passed
        const propResults = Object.values(propResultsMap);
        const passed = propResults.filter(x => typeof x.passed === 'boolean').every(x => x.passed === true);

        return {
            behavior: include ? 'include' : 'exclude',
            criteria: {criteria: cloneDeep(authorOpts)},
            propertyResults: propResults,
            passed,
        };
    }

    async getCommentCheckCacheResult(item: Comment, checkConfig: object): Promise<CheckResultEntity | Pick<CheckResultEntity, 'triggered' | 'results'> | undefined> {
        const userName = getActivityAuthorName(item.author);
        const hash = `commentUserResult-${userName}-${item.link_id}-${objectHash.sha1(checkConfig)}`;
        this.stats.cache.commentCheck.requests++;
        this.stats.cache.commentCheck.requestTimestamps.push(Date.now());
        await this.stats.cache.commentCheck.identifierRequestCount.set(hash, (await this.stats.cache.commentCheck.identifierRequestCount.wrap(hash, () => 0) as number) + 1);
        let result = await this.cache.get(hash) as { id: string, results: (RuleResultEntity | RuleSetResultEntity)[], triggered: boolean } | undefined | null;
        if (result === null) {
            result = undefined;
        }
        if (result === undefined) {
            this.stats.cache.commentCheck.miss++;
            return result;
        }
        const {id, results, triggered} = result;
        this.logger.debug(`Cache Hit: Comment Check for ${userName} in Submission ${item.link_id} (Hash ${hash})`);
        // check if the Check was persisted since that would be easiest
        const persisted = await this.database.getRepository(CheckResultEntity).findOne({where: {id}}) as CheckResultEntity;
        if (persisted !== null) {
            return persisted;
        }
        const hydratedResults: (RuleResultEntity | RuleSetResultEntity)[] = [];
        const premiseRepo = this.database.getRepository(RulePremise);
        for (const r of results) {
            if (isRuleSetResult(r)) {
                hydratedResults.push(new RuleSetResultEntity({
                    triggered: r.triggered,
                    condition: r.condition,
                    results: await mapAsync(r.results, async (ruleResult: RuleResultEntity) => {
                        const prem = await premiseRepo.findOneBy({
                            configHash: ruleResult.premise.configHash,
                            kindId: ruleResult.premise.kindId,
                            managerId: ruleResult.premise.managerId,
                        }) as RulePremise;
                        return new RuleResultEntity({
                            ...ruleResult,
                            premise: prem,
                            fromCache: true
                        })
                    })
                }))
            } else {
                const prem = await premiseRepo.findOneBy({
                    configHash: r.premise.configHash,
                    kindId: r.premise.kindId,
                    managerId: r.premise.managerId,
                }) as RulePremise;
                hydratedResults.push(new RuleResultEntity({
                    ...r,
                    premise: prem,
                    fromCache: true
                }));
            }
        }
        return {results: hydratedResults, triggered};
    }

    async setCommentCheckCacheResult(item: Comment, checkConfig: object, result: CheckResultEntity, ttl: number) {
        const userName = getActivityAuthorName(item.author);
        const hash = `commentUserResult-${userName}-${item.link_id}-${objectHash.sha1(checkConfig)}`
        await this.cache.set(hash, {id: result.id, results: result.results, triggered: result.triggered}, { ttl });
        this.logger.debug(`Cached check result '${result.check.name}' for User ${userName} on Submission ${item.link_id} for ${ttl} seconds (Hash ${hash})`);
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
        this.ttlDefaults = {authorTTL, userNotesTTL, wikiTTL, commentTTL, submissionTTL, filterCriteriaTTL, subredditTTL, selfTTL, modNotesTTL};
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
        const { caching, credentials, retention, ...init } = initOptions;

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
                    botName: this.botName,
                    database: this.defaultDatabase,
                    retention: retention ?? this.retention,
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
            await resource.initStats();
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
        await resource.initDatabaseDelayedActivities();

        return resource;
    }

    async destroy(subName: string) {
        const res = this.get(subName);
        if(res !== undefined) {
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
        if(subreddit === null || subreddit === undefined || subreddit == '') {
            throw new CMError('Subreddit name cannot be empty');
        }
        let subredditNames = await this.defaultCache.get(`modInvites`) as (string[] | undefined | null);
        if (subredditNames === undefined || subredditNames === null) {
            subredditNames = [];
        }
        const cleanName = subreddit.trim();

        if(subredditNames.some(x => x.trim().toLowerCase() === cleanName.toLowerCase())) {
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

export const checkItemFilter = async (item: (Submission | Comment), filter: ItemOptions, resources: SubredditResources, options?: {logger?: Logger, source?: ActivitySource, includeIdentifier?: boolean}): Promise<[boolean, ('inclusive' | 'exclusive' | undefined), FilterResult<TypedActivityState>]> => {

    const {
        logger: parentLogger = NoopLogger,
        source,
        includeIdentifier = false,
    } = options || {};

    const labels = ['Item Filter'];
    if(includeIdentifier) {
        labels.push(`${asSubmission(item) ? 'SUB' : 'COM'} ${item.id}`);
    }
    const logger = parentLogger.child({labels}, mergeArr);
    const {
        include = [],
        excludeCondition = 'AND',
        exclude = [],
    } = filter;
    let itemPass = null;

    const allCritResults: FilterCriteriaResult<TypedActivityState>[] = [];

    if(include.length > 0) {
        let index = 1
        for(const namedState of include) {
            const { criteria: state, name } = namedState;
            let critResult: FilterCriteriaResult<TypedActivityState>;

            // need to determine if criteria is for comment or submission state
            // and if its comment state WITH submission state then break apart testing into individual activity testing
            if(isCommentState(state) && asComment(item) && state.submissionState !== undefined) {
                const {submissionState, ...restCommentState} = state;

                const [subPass, subPropertyResult] = await checkCommentSubmissionStates(item, submissionState, resources, parentLogger, source);

                if(!subPass) {
                    // generate dummy results for the rest of the comment state since we don't need to test it
                    const [propResultsMap, definedStateCriteria] = generateItemFilterHelpers(restCommentState, true);
                    propResultsMap.submissionState = subPropertyResult;
                    critResult = {
                        behavior: 'include',
                        criteria: cloneDeep(namedState),
                        propertyResults: Object.values(propResultsMap),
                        passed: false
                    }
                } else {
                    critResult = await resources.testItemCriteria(item, {criteria: restCommentState}, parentLogger, true, source);
                    critResult.criteria = cloneDeep(namedState);
                    critResult.propertyResults.unshift(subPropertyResult);
                }
            } else {
                critResult = await resources.testItemCriteria(item, namedState, parentLogger, true, source);
            }

            if(critResult.propertyResults.some(x => x.property === 'source')
            && critResult.criteria.criteria.source === undefined) {
                critResult.criteria.criteria.source = source;
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

    if (exclude.length > 0) {
        let index = 1;
        const summaries: string[] = [];
        for (const namedState of exclude) {

            const { criteria: state, name } = namedState;

            let critResult: FilterCriteriaResult<TypedActivityState>;

            if(isCommentState(state) && asComment(item) && state.submissionState !== undefined) {
                const {submissionState, ...restCommentState} = state;

                const [subPass, subPropertyResult] = await checkCommentSubmissionStates(item, submissionState, resources, parentLogger, source);

                if(!subPass) {
                    // generate dummy results for the rest of the comment state since we don't need to test it
                    const [propResultsMap, definedStateCriteria] = generateItemFilterHelpers(restCommentState, false);
                    propResultsMap.submissionState = subPropertyResult;
                    critResult = {
                        behavior: 'include',
                        criteria: {...namedState},
                        propertyResults: Object.values(propResultsMap),
                        passed: false
                    }
                } else {
                    critResult = await resources.testItemCriteria(item, {criteria: restCommentState}, parentLogger, false, source);
                    critResult.criteria = {...namedState};
                    critResult.propertyResults.unshift(subPropertyResult);
                }
            } else {
                critResult = await resources.testItemCriteria(item, namedState, parentLogger, false, source);
            }

            if(critResult.propertyResults.some(x => x.property === 'source')) {
                critResult.criteria.criteria.source = source;
            }

            //critResult = await resources.testItemCriteria(item, state, parentLogger, false);
            allCritResults.push(critResult);


            const [summary, details] = filterCriteriaSummary(critResult);
            if (critResult.passed) {
                if (excludeCondition === 'OR') {
                    logger.verbose(`${PASS} (OR) => Exclusive Item Criteria ${index} => ${summary}`);
                    logger.debug(`Criteria Details: \n${details.join('\n')}`);
                    itemPass = true;
                    break;
                }
                summaries.push(summary);
                logger.debug(`${PASS} (AND) => Exclusive Item Criteria ${index} => ${summary}`);
                logger.debug(`Criteria Details: \n${details.join('\n')}`);
            } else if (!critResult.passed) {
                if (excludeCondition === 'AND') {
                    logger.verbose(`${FAIL} (AND) => Exclusive Item Criteria ${index} => ${summary}`);
                    logger.debug(`Criteria Details: \n${details.join('\n')}`);
                    itemPass = false;
                    break;
                }
                summaries.push(summary);
                logger.debug(`${FAIL} (OR) => Exclusive Item Criteria ${index} => ${summary}`);
                logger.debug(`Criteria Details: \n${details.join('\n')}`);
            }
            index++;
        }
        if (excludeCondition === 'AND' && itemPass === null) {
            itemPass = true;
        }
        if (itemPass !== true) {
            if (excludeCondition === 'OR') {
                logger.verbose(`${FAIL} => Exclusive Item criteria not matched => ${summaries.length === 1 ? `${summaries[0]}` : '(many, see debug)'}`);
            }
            return [false, 'exclusive', {criteriaResults: allCritResults, join: excludeCondition, passed: false}]
        } else if (excludeCondition === 'AND') {
            logger.verbose(`${PASS} => Exclusive Item criteria matched => ${summaries.length === 1 ? `${summaries[0]}` : '(many, see debug)'}`);
        }
        return [true, 'exclusive', {criteriaResults: allCritResults, join: excludeCondition, passed: true}];
    }

    return [true, undefined, {criteriaResults: allCritResults, join: 'OR', passed: true}];
}

export const checkCommentSubmissionStates = async (item: Comment, submissionStates: SubmissionState[], resources: SubredditResources, logger: Logger, source?: ActivitySource, excludeCondition?: JoinOperands): Promise<[boolean, FilterCriteriaPropertyResult<CommentState>]> => {
    // test submission state first since it's more likely(??) we have crit results or cache data for this submission than for the comment

    // get submission
    // @ts-ignore
    const subProxy = await resources.client.getSubmission(await item.link_id);
    // @ts-ignore
    const sub = await resources.getActivity(subProxy);

    const subStatesFilter: ItemOptions = {
        include: excludeCondition === undefined ? submissionStates.map(x => ({criteria: x})) : undefined,
        excludeCondition,
        exclude: excludeCondition === undefined ? undefined : submissionStates.map(x => ({criteria: x}))
    }

    const [subPass, _, subFilterResults] = await checkItemFilter(sub, subStatesFilter, resources, {logger});
    const subPropertyResult: FilterCriteriaPropertyResult<CommentState> = {
        property: 'submissionState',
        behavior: excludeCondition !== undefined ? 'exclude' : 'include',
        passed: subPass,
        found: {
            // TODO change this to exclude condition as well?
            join: 'OR',
            criteriaResults: subFilterResults.criteriaResults,
            passed: subPass,
        }
    };

    return [subPass, subPropertyResult];
}
