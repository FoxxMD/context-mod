import objectHash from 'object-hash';
import {
    activityIsDeleted,
    activityIsFiltered,
    activityIsRemoved,
    getAuthorHistoryAPIOptions,
    renderContent,
    TemplateContext
} from "../Utils/SnoowrapUtils";
import {map as mapAsync} from 'async';
import winston, {Logger} from "winston";
import {Response} from 'node-fetch';
import {
    asActivity,
    asComment,
    asStrongImageHashCache,
    asSubmission,
    asSubreddit,
    asUserNoteCriteria,
    cacheStats,
    criteriaPassWithIncludeBehavior,
    escapeRegex,
    FAIL,
    fetchExternalResult,
    filterByTimeRequirement,
    filterCriteriaSummary,
    formatNumber,
    frequencyEqualOrLargerThanMin,
    generateFullWikiUrl,
    generateItemFilterHelpers,
    getActivityAuthorName,
    getActivitySubredditName,
    isCommentState,
    isRuleSetResult,
    isStrongSubredditState,
    isSubmission,
    isUser,
    matchesRelativeDateTime,
    mergeArr,
    modActionCriteriaSummary,
    parseDurationValToDuration,
    parseExternalUrl,
    parseRedditEntity,
    parseStringToRegex,
    parseWikiContext,
    PASS,
    redisScanIterator,
    removeUndefinedKeys,
    shouldCacheSubredditStateCriteriaResult,
    subredditStateIsNameOnly,
    testMaybeStringRegex,
    toStrongSubredditState, toStrongTTLConfig,
    truncateStringToLength,
    userNoteCriteriaSummary
} from "../util";
import {
    ActivityDispatch,
    CacheConfig,
    Footer,
    HistoricalStatsDisplay,
    ResourceStats, StrongTTLConfig,
    ThirdPartyCredentialsJsonConfig
} from "../Common/interfaces";
import UserNotes from "./UserNotes";
import {Cache} from 'cache-manager';
import {Comment, RedditUser, Submission, Subreddit, WikiPage} from "snoowrap/dist/objects";
import {cacheTTLDefaults, createHistoricalDisplayDefaults,} from "../Common/defaults";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";
import dayjs, {Dayjs} from "dayjs";
import ImageData from "../Common/ImageData";
import {Between, DataSource, DeleteQueryBuilder, LessThan, Repository, SelectQueryBuilder} from "typeorm";
import {CMEvent as ActionedEventEntity, CMEvent} from "../Common/Entities/CMEvent";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import globrex from 'globrex';
import {CMError, isStatusError, MaybeSeriousErrorWithCause, SimpleError} from "../Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {ManagerEntity} from "../Common/Entities/ManagerEntity";
import {Bot} from "../Common/Entities/Bot";
import {DispatchedEntity} from "../Common/Entities/DispatchedEntity";
import {ActivitySourceEntity} from "../Common/Entities/ActivitySourceEntity";
import {TotalStat} from "../Common/Entities/Stats/TotalStat";
import {TimeSeriesStat} from "../Common/Entities/Stats/TimeSeriesStat";
import {CheckResultEntity} from "../Common/Entities/CheckResultEntity";
import {RuleSetResultEntity} from "../Common/Entities/RuleSetResultEntity";
import {RulePremise} from "../Common/Entities/RulePremise";
import cloneDeep from "lodash/cloneDeep";
import {
    asModLogCriteria,
    asModNoteCriteria,
    AuthorCriteria,
    CommentState,
    ModLogCriteria,
    ModNoteCriteria,
    orderedAuthorCriteriaProps,
    RequiredAuthorCrit,
    StrongSubredditCriteria,
    SubmissionState,
    SubredditCriteria,
    toFullModLogCriteria,
    toFullModNoteCriteria,
    TypedActivityState,
    UserNoteCriteria
} from "../Common/Infrastructure/Filters/FilterCriteria";
import {
    ActivitySourceValue,
    ConfigFragmentParseFunc,
    DurationVal,
    EventRetentionPolicyRange,
    ImageHashCacheData,
    JoinOperands,
    ModActionType,
    ModeratorNameCriteria,
    ModUserNoteLabel,
    RelativeDateTimeMatch,
    statFrequencies,
    StatisticFrequencyOption,
    WikiContext
} from "../Common/Infrastructure/Atomic";
import {
    AuthorOptions,
    FilterCriteriaPropertyResult,
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
    ActivityType,
    AuthorHistorySort,
    CachedFetchedActivitiesResult,
    FetchedActivitiesResult,
    SnoowrapActivity,
    SubredditRemovalReason
} from "../Common/Infrastructure/Reddit";
import {AuthorCritPropHelper} from "../Common/Infrastructure/Filters/AuthorCritPropHelper";
import {NoopLogger} from "../Utils/loggerFactory";
import {
    compareDurationValue,
    comparisonTextOp,
    parseDurationComparison,
    parseGenericValueComparison,
    parseGenericValueOrPercentComparison,
    parseReportComparison
} from "../Common/Infrastructure/Comparisons";
import {asCreateModNoteData, CreateModNoteData, ModNote, ModNoteRaw} from "./ModNotes/ModNote";
import {IncludesData} from "../Common/Infrastructure/Includes";
import {parseFromJsonOrYamlToObject} from "../Common/Config/ConfigUtil";
import ConfigParseError from "../Utils/ConfigParseError";
import {ActivityReport} from "../Common/Entities/ActivityReport";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";
import {ActivitySource} from "../Common/ActivitySource";
import {SubredditResourceOptions} from "../Common/Subreddit/SubredditResourceInterfaces";
import {SubredditStats} from "./Stats";
import {CMCache} from "../Common/Cache";

export const DEFAULT_FOOTER = '\r\n*****\r\nThis action was performed by [a bot.]({{botLink}}) Mention a moderator or [send a modmail]({{modmailLink}}) if you have any ideas, questions, or concerns about this action.';

export interface ExternalResourceOptions {
    subreddit?: Subreddit
    defaultTo?: 'url' | 'wiki',
    force?: boolean
    shared?: boolean,
    ttl?: number
}

export class SubredditResources {
    
    ttl: StrongTTLConfig;
    //enabled!: boolean;
    protected useSubredditAuthorCache!: boolean;
    name: string;
    botName: string;
    logger: Logger;
    userNotes: UserNotes;
    footer: false | string = DEFAULT_FOOTER;
    subreddit: Subreddit
    database: DataSource
    client: ExtendedSnoowrap
    cache: CMCache
    cacheSettingsHash?: string;
    thirdPartyCredentials: ThirdPartyCredentialsJsonConfig;
    delayedItems: ActivityDispatch[] = [];
    botAccount?: string;
    dispatchedActivityRepo: Repository<DispatchedEntity>
    activitySourceRepo: Repository<ActivitySourceEntity>
    retention?: EventRetentionPolicyRange
    managerEntity: ManagerEntity
    botEntity: Bot
    
    subredditStats: SubredditStats

    constructor(name: string, options: SubredditResourceOptions) {
        const {
            subreddit,
            logger,
            ttl,
            botName,
            database,
            cache,
            prefix,
            cacheType,
            cacheSettingsHash,
            client,
            thirdPartyCredentials,
            delayedItems = [],
            botAccount,
            managerEntity,
            botEntity,
            statFrequency,
            retention,
            footer = DEFAULT_FOOTER,
        } = options || {};

        this.managerEntity = managerEntity;
        this.botEntity = botEntity;
        this.botName = botName;
        this.delayedItems = delayedItems;
        this.cacheSettingsHash = cacheSettingsHash;
        this.database = database;
        this.dispatchedActivityRepo = this.database.getRepository(DispatchedEntity);
        this.activitySourceRepo = this.database.getRepository(ActivitySourceEntity);
        this.retention = retention;
        //this.prefix = prefix;
        this.client = client;
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
        this.cache = cache;
        this.cache.setLogger(this.logger);

        this.subredditStats = new SubredditStats(database, managerEntity, cache, statFrequency, this.logger);

        const cacheUseCB = (miss: boolean) => {
            this.subredditStats.incrementCacheTypeStat('userNotes', undefined, miss);
        }

        this.ttl = ttl;
        this.thirdPartyCredentials = thirdPartyCredentials;
        this.footer = footer;
        this.setRetention(retention, true);

        this.userNotes = new UserNotes(this.ttl.userNotesTTL, this.subreddit.display_name, this.client, this.logger, this.cache, cacheUseCB)
    }

    async configure(options: SubredditResourceOptions) {
        const {
            ttl,
            retention,
            thirdPartyCredentials,
            footer = DEFAULT_FOOTER,
            statFrequency,
        } = options;

        this.ttl = ttl;
        this.thirdPartyCredentials = thirdPartyCredentials;
        this.footer = footer;
        let forceStatInit = false;
        if(this.subredditStats.statFrequency !== statFrequency) {
            await this.subredditStats.destroy();
            this.subredditStats.statFrequency = statFrequency;
            forceStatInit = true;
        }

        if(!options.cache.equalProvider(this.cache.providerOptions)) {
            this.cache = options.cache;
            this.cache.setLogger(this.logger);
            this.subredditStats = new SubredditStats(this.database, this.managerEntity, this.cache, statFrequency, this.logger);
        }

        await this.subredditStats.initStats(forceStatInit);
        if(this.subredditStats.historicalSaveInterval === undefined) {
            this.subredditStats.setHistoricalSaveInterval();
        }
        await this.initDatabaseDelayedActivities();
        this.setRetention(retention);
    }

    setRetention(retention?: EventRetentionPolicyRange, init = false) {
        const hashableRetention = retention ?? null;
        const hashableExistingRetention = this.retention ?? null;

        if(init || (objectHash.sha1(hashableRetention) !== objectHash.sha1(hashableExistingRetention))) {
            this.retention = retention;
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
    }

    async destroy() {
        // if(this.pruneInterval !== undefined && this.cacheType === 'memory' && this.cacheSettingsHash !== 'default') {
        //     clearInterval(this.pruneInterval);
        //     this.cache?.reset();
        // }
        await this.cache.destroy();
        await this.subredditStats.destroy();
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
        return this.subredditStats.initStats();
    }

    updateHistoricalStats(data: Partial<HistoricalStatsDisplay>) {
        this.subredditStats.updateHistoricalStats(data);
    }

    getHistoricalDisplayStats(): HistoricalStatsDisplay {
        return this.subredditStats.getHistoricalDisplayStats();
    }

    setHistoricalSaveInterval() {
        this.subredditStats.setHistoricalSaveInterval();
    }

    async getCacheKeyCount() {
       return this.cache.getCacheKeyCount();
    }

    async resetCacheForItem(item: Comment | Submission | RedditUser) {
        if (asActivity(item)) {
            if (this.ttl.filterCriteriaTTL !== false) {
                await this.cache.deleteCacheByKeyPattern(`itemCrit-${item.name}*`);
            }
            await this.setActivity(item, false);
        } else if (isUser(item) && this.ttl.filterCriteriaTTL !== false) {
            await this.cache.deleteCacheByKeyPattern(`authorCrit-*-${getActivityAuthorName(item)}*`);
        }
    }

    getCacheTotals() {
        return this.subredditStats.getCacheTotals();
    }

    async getStats() {
        return this.subredditStats.getCacheStatsForManager();
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
        if(this.ttl.selfTTL !== false) {
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
        if(this.ttl.selfTTL !== false) {
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
            if (this.ttl.submissionTTL !== false && asSubmission(item)) {
                hash = `sub-${item.name}`;
                const cachedSubmission = await this.cache.get(hash);
                if (cachedSubmission !== undefined && cachedSubmission !== null) {
                    await this.subredditStats.incrementCacheTypeStat('submission', hash, false);
                    this.logger.debug(`Cache Hit: Submission ${item.name}`);
                    return cachedSubmission;
                }
                await this.subredditStats.incrementCacheTypeStat('submission', hash, true);
                return await this.setActivity(item);
            } else if (this.ttl.commentTTL !== false) {
                hash = `comm-${item.name}`;
                const cachedComment = await this.cache.get(hash);
                if (cachedComment !== undefined && cachedComment !== null) {
                    this.logger.debug(`Cache Hit: Comment ${item.name}`);
                    await this.subredditStats.incrementCacheTypeStat('comment', hash, false);
                    return cachedComment;
                }
                await this.subredditStats.incrementCacheTypeStat('comment', hash, true);
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
            if (this.ttl.submissionTTL !== false && isSubmission(item)) {
                hash = `sub-${item.name}`;
                if (tryToFetch && item instanceof Submission) {
                    // @ts-ignore
                    const itemToCache = await item.refresh();
                    await this.cache.set(hash, itemToCache, {ttl: this.ttl.submissionTTL});
                    return itemToCache;
                } else {
                    // @ts-ignore
                    await this.cache.set(hash, item, {ttl: this.ttl.submissionTTL});
                    return item;
                }
            } else if (this.ttl.commentTTL !== false) {
                hash = `comm-${item.name}`;
                if (tryToFetch && item instanceof Comment) {
                    // @ts-ignore
                    const itemToCache = await item.refresh();
                    await this.cache.set(hash, itemToCache, {ttl: this.ttl.commentTTL});
                    return itemToCache;
                } else {
                    // @ts-ignore
                    await this.cache.set(hash, item, {ttl: this.ttl.commentTTL});
                    return item;
                }
            }
            return item;
        } catch (e: any) {
            if(e.message !== undefined && e.message.includes('Cannot read properties of undefined (reading \'constructor\')')) {
                throw new ErrorWithCause('Error occurred while trying to add Activity to cache (Comment likely does not exist)', {cause: e});
            } else {
                throw new ErrorWithCause('Error occurred while trying to add Activity to cache', {cause: e});
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
        if(this.ttl.selfTTL !== false) {
            const hash = asSubmission(item) ? `sub-recentSelf-${item.name}` : `comm-recentSelf-${item.name}`;
            // @ts-ignore
            await this.cache.set(hash, item, {ttl: this.ttl.selfTTL});
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
            if (this.ttl.subredditTTL !== false) {

                hash = `sub-${subName}`;
                const cachedSubreddit = await this.cache.get(hash);
                if (cachedSubreddit !== undefined && cachedSubreddit !== null) {
                    logger.debug(`Cache Hit: Subreddit ${subName}`);
                    await this.subredditStats.incrementCacheTypeStat('subreddit', hash, false);
                    return new Subreddit(cachedSubreddit, this.client, false);
                }
                await this.subredditStats.incrementCacheTypeStat('subreddit', hash, true);
                // @ts-ignore
                const subreddit = await (item instanceof Subreddit ? item : this.client.getSubreddit(subName)).fetch() as Subreddit;
                // @ts-ignore
                await this.cache.set(hash, subreddit, {ttl: this.ttl.subredditTTL});
                // @ts-ignore
                return subreddit as Subreddit;
            } else {
                // @ts-ignore
                let subreddit = await (item instanceof Subreddit ? item : this.client.getSubreddit(subName)).fetch();

                return subreddit as Subreddit;
            }
        } catch (err: any) {
            const cmError = new CMError('Error while trying to fetch a cached subreddit', {cause: err, logged: true});
            this.logger.error(cmError);
            throw cmError;
        }
    }

    async getSubredditModerators(rawSubredditVal?: Subreddit | string) {
        const subredditVal = rawSubredditVal ?? this.subreddit;
        const subName = typeof subredditVal === 'string' ? subredditVal : subredditVal.display_name;
        const hash = `sub-${subName}-moderators`;
        if (this.ttl.subredditTTL !== false) {
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

        if (this.ttl.subredditTTL !== false) {
            // @ts-ignore
            await this.cache.set(hash, mods.map(x => x.name), {ttl: this.ttl.subredditTTL});
        }

        return mods;
    }

    async getSubredditModeratorPermissions(rawUserVal: RedditUser | string, rawSubredditVal?: Subreddit | string): Promise<string[]> {
        const mods = await this.getSubredditModerators(rawSubredditVal);
        const user = rawUserVal instanceof RedditUser ? rawUserVal.name : rawUserVal;

        const mod = mods.find(x => x.name.toLowerCase() === user.toLowerCase());
        if(mod === undefined) {
            return [];
        }
        // @ts-ignore
        return mod.mod_permissions as string[];
    }

    async getSubredditContributors(): Promise<RedditUser[]> {
        const subName = this.subreddit.display_name;
        const hash = `sub-${subName}-contributors`;
        if (this.ttl.subredditTTL !== false) {
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

        if (this.ttl.subredditTTL !== false) {
            // @ts-ignore
            await this.cache.set(hash, contributors.map(x => x.name), {ttl: this.ttl.subredditTTL});
        }

        return contributors.map(x => new RedditUser({name: x.name}, this.client, false));
    }

    async addUserToSubredditContributorsCache(user: RedditUser) {
        const subName = this.subreddit.display_name;
        const hash = `sub-${subName}-contributors`;
        if (this.ttl.subredditTTL !== false) {
            const cachedVal = await this.cache.get(hash);
            if (cachedVal !== undefined && cachedVal !== null) {
                const cacheContributors = cachedVal as string[];
                if(!cacheContributors.includes(user.name)) {
                    cacheContributors.push(user.name);
                    await this.cache.set(hash, cacheContributors, {ttl: this.ttl.subredditTTL});
                }
            }
        }
    }

    async removeUserFromSubredditContributorsCache(user: RedditUser) {
        const subName = this.subreddit.display_name;
        const hash = `sub-${subName}-contributors`;
        if (this.ttl.subredditTTL !== false) {
            const cachedVal = await this.cache.get(hash);
            if (cachedVal !== undefined && cachedVal !== null) {
                const cacheContributors = cachedVal as string[];
                if(cacheContributors.includes(user.name)) {
                    await this.cache.set(hash, cacheContributors.filter(x => x !== user.name), {ttl: this.ttl.subredditTTL});
                }
            }
        }
    }

    async hasSubreddit(name: string) {
        if (this.ttl.subredditTTL !== false) {
            const hash = `sub-${name}`;
            const val = await this.cache.get(hash);
            await this.subredditStats.incrementCacheTypeStat('subreddit', hash, val === undefined || val === null);
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

        if (this.ttl.modNotesTTL !== false) {
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

        if (this.ttl.modNotesTTL !== false) {
            // @ts-ignore
            await this.cache.set(hash, fetchedNotes, {ttl: this.ttl.modNotesTTL});
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

        if (this.ttl.modNotesTTL !== false) {
            const hash = `authorModNotes-${this.subreddit.display_name}-${data.user.name}`;
            const cachedModNoteData = await this.cache.get(hash) as ModNoteRaw[] | null | undefined;
            if (cachedModNoteData !== undefined && cachedModNoteData !== null) {
                this.logger.debug(`Adding new Note ${newNote.id} to Author ${data.user.name} Note cache`);
                await this.cache.set(hash, [newNote, ...cachedModNoteData], {ttl: this.ttl.modNotesTTL});
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
        if (this.ttl.authorTTL !== false) {
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

            if (this.ttl.authorTTL !== false) {
                // @ts-ignore
                await this.cache.set(hash, user, {ttl: this.ttl.authorTTL});
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

            if (this.ttl.authorTTL !== false) {
                if (this.useSubredditAuthorCache) {
                    hashObj.subreddit = this.subreddit;
                }

                const cacheVal = await this.cache.get(cacheKey);

                if(cacheVal === undefined || cacheVal === null) {
                    await this.subredditStats.incrementCacheTypeStat('author', userName, true);
                } else {
                    await this.subredditStats.incrementCacheTypeStat('author', userName, false);
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

                if(this.ttl.authorTTL !== false) {
                    this.cache.set(cacheKey, {pre: pre, rawCount, apiCount, preMaxTrigger}, {ttl: this.ttl.authorTTL})
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

    async getExternalResource(val: string, options: ExternalResourceOptions = {}): Promise<{ val: string, fromCache: boolean, response?: Response, hash?: string, subreddit?: string }> {
        const {defaultTo} = options;
        let wikiContext = parseWikiContext(val);

        let extUrl = wikiContext === undefined ? parseExternalUrl(val) : undefined;

        if (extUrl === undefined && wikiContext === undefined) {
            if (defaultTo === 'url') {
                extUrl = val;
            } else if (defaultTo === 'wiki') {
                wikiContext = {wiki: val};
            }
        }

        if (wikiContext !== undefined) {
            const res = await this.getWikiPage(wikiContext, options);
            return {...res, subreddit: wikiContext.subreddit ?? this.subreddit.display_name};
        }
        if (extUrl !== undefined) {
            return await this.getCachedUrlResult(extUrl, options);
        }

        return {val, fromCache: false};
    }

    async getCachedUrlResult(extUrl: string, options: ExternalResourceOptions = {}): Promise<{ val: string, fromCache: boolean, response?: Response, hash?: string }> {
        const cacheKey = extUrl;
        const {force = false, shared = false} = options;

        // try to get cached value first
        if (!force && this.ttl.wikiTTL !== false) {
            const cachedContent = await this.cache.get(cacheKey, shared);
            if (cachedContent !== undefined && cachedContent !== null) {
                this.logger.debug(`Content Cache Hit: ${cacheKey}`);
                await this.subredditStats.incrementCacheTypeStat('content', cacheKey, false);
                return {val: cachedContent as string, fromCache: true, hash: cacheKey};
            } else {
                await this.subredditStats.incrementCacheTypeStat('content', cacheKey, true);
            }
        }

        try {
            const [wikiContentVal, responseVal] = await fetchExternalResult(extUrl as string, this.logger);
            return {val: wikiContentVal, fromCache: false, response: responseVal, hash: cacheKey};
        } catch (err: any) {
            throw new CMError(`Error occurred while trying to fetch the url ${extUrl}`, {cause: err});
        }
    }

    async getWikiPage(data: WikiContext, options: ExternalResourceOptions = {}): Promise<{ val: string, fromCache: boolean, response?: Response, hash?: string, subreddit?: string, wikiPage?: WikiPage}> {
        const {subreddit: subredditArg, force = false, shared = false } = options;
        const {
            subreddit = subredditArg !== undefined ? subredditArg.display_name : this.subreddit.display_name,
            wiki
        } = data;

        const cacheKey = `${subreddit}-content-${wiki}${data.subreddit !== undefined ? `|${data.subreddit}` : ''}`;

        if (!force && this.ttl.wikiTTL !== false) {
            const cachedContent = await this.cache.get(cacheKey, shared);
            if (cachedContent !== undefined && cachedContent !== null) {
                this.logger.debug(`Content Cache Hit: ${cacheKey}`);
                await this.subredditStats.incrementCacheTypeStat('content', cacheKey, false);
                return {val: cachedContent as string, fromCache: true, hash: cacheKey};
            } else {
                await this.subredditStats.incrementCacheTypeStat('content', cacheKey, true);
            }
        }

        let sub = this.client.getSubreddit(subreddit);

        try {
            // @ts-ignore
            const wikiPage = await sub.getWikiPage(wiki).fetch();
            const wikiContent = wikiPage.content_md;
            return {val: wikiContent, fromCache: false, hash: cacheKey, wikiPage};
        } catch (err: any) {
            if (isStatusError(err)) {
                const error = err.statusCode === 404 ? 'does not exist' : 'is not accessible';
                let reasons = [];
                if (!this.client.scope.includes('wikiread')) {
                    reasons.push(`Bot does not have 'wikiread' oauth permission`);
                } else {
                    const modPermissions = await this.getSubredditModeratorPermissions(this.botName, subreddit);
                    if (!modPermissions.includes('all') && !modPermissions.includes('wiki')) {
                        reasons.push(`Bot does not have required mod permissions ('all'  or 'wiki') to read restricted wiki pages`);
                    }
                }

                throw new CMError(`Wiki page ${generateFullWikiUrl(subreddit, wiki)} ${error} (${err.statusCode})${reasons.length > 0 ? `because: ${reasons.join(' | ')}` : '.'}`, {cause: err});
            } else {
                throw new CMError(`Wiki page ${generateFullWikiUrl(subreddit, wiki)} could not be read`, {cause: err});
            }
        }
    }

    async getContent(val: string, options: ExternalResourceOptions = {}): Promise<string> {
        const {val: wikiContent, fromCache, hash} = await this.getExternalResource(val, options);
        const {ttl = this.ttl.wikiTTL, shared = false} = options;

        if (!fromCache && hash !== undefined && ttl !== false) {
            await this.cache.set(hash, wikiContent, {ttl, shared});
        }

        return wikiContent;
    }

    /**
     * Convenience method for using getContent and SnoowrapUtils@renderContent in one method
     * */
    async renderContent(contentStr: string, activity: SnoowrapActivity, ruleResults: RuleResultEntity[] = [], actionResults: ActionResultEntity[] = [], templateData: TemplateContext = {}) {
        const content = await this.getContent(contentStr);

        const {usernotes = this.userNotes, ...restData} = templateData;
        return await renderContent(content, {
            ...restData,
            activity,
            usernotes,
            ruleResults,
            actionResults,
        });
    }

    async renderFooter(item: Submission | Comment, footer: false | string | undefined = this.footer) {
        if (footer === false) {
            return '';
        }
        return this.renderContent(footer, item);
    }

    async getConfigFragment<T>(includesData: IncludesData, parseFunc?: ConfigFragmentParseFunc): Promise<T> {

        const {
            path,
            ttl = 60,
        } = includesData;

        const {val: configStr, fromCache, hash, response, subreddit} = await this.getExternalResource(path, {shared: true});

        const [format, configObj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(configStr);
        if (configObj === undefined) {
            //this.logger.error(`Could not parse includes URL of '${configStr}' contents as JSON or YAML.`);
            this.logger.error(yamlErr);
            this.logger.debug(jsonErr);
            throw new ConfigParseError(`Could not parse includes URL of '${configStr}' contents as JSON or YAML.`)
        }

        const rawData = configObj.toJS();
        let validatedData: T;
        // otherwise now we want to validate it if a function is present
        if(parseFunc !== undefined) {
            try {
                validatedData = parseFunc(configObj.toJS(), fromCache, subreddit) as unknown as T;
            } catch (e) {
                throw e;
            }
        } else {
            validatedData = rawData as unknown as T;
        }

        if(fromCache) {
            this.logger.verbose(`Got Config Fragment ${path} from cache`);
            return validatedData as unknown as T;
        }

        let ttlVal: number | false = this.ttl.wikiTTL;
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
                ttlVal = this.ttl.wikiTTL;
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
                        ttlVal = this.ttl.wikiTTL;
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
                    ttlVal = 60;
                }
            }
        }

        if (ttlVal !== false) {
            this.cache.set(hash as string, configStr, {ttl: ttlVal, shared: true});
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
                await this.cache.set(`sub-${s.display_name}`, s, {ttl: this.ttl.subredditTTL});
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

        // return early if there are no states to filter by!
        if(states.length === 0) {
            return items;
        }

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
        if (this.ttl.filterCriteriaTTL !== false && shouldCacheSubredditStateCriteriaResult(state)) {
            try {
                const hash = `subredditCrit-${getActivitySubredditName(item)}-${objectHash.sha1(state)}`;
                const cachedItem = await this.cache.get(hash);
                if (cachedItem !== undefined && cachedItem !== null) {
                    this.logger.debug(`Cache Hit: Subreddit Check on ${getActivitySubredditName(item)} (Hash ${hash})`);
                    await this.subredditStats.incrementCacheTypeStat('subredditCrit', hash, false);
                    return cachedItem as boolean;
                }
                const itemResult = await this.isSubreddit(await this.getSubreddit(item), state, author, this.logger);
                await this.subredditStats.incrementCacheTypeStat('subredditCrit', hash, true);
                await this.cache.set(hash, itemResult, {ttl: this.ttl.filterCriteriaTTL});
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

        if (this.ttl.filterCriteriaTTL !== false) {
            // in the criteria check we only actually use the `item` to get the author flair
            // which will be the same for the entire subreddit
            //
            // so we can create a hash only using subreddit-author-criteria
            // and ignore the actual item
            const hashObj = {...authorOpts, include};
            const userName = getActivityAuthorName(item.author);
            const hash = `authorCrit-${this.subreddit.display_name}-${userName}-${objectHash.sha1(hashObj)}`;

            // need to check shape of result to invalidate old result type
            let cachedAuthorTest: FilterCriteriaResult<AuthorCriteria> = await this.cache.get(hash) as FilterCriteriaResult<AuthorCriteria>;
            if(cachedAuthorTest !== null && cachedAuthorTest !== undefined && typeof cachedAuthorTest === 'object') {
                this.logger.debug(`Cache Hit: Author Check on ${userName} (Hash ${hash})`);
                await this.subredditStats.incrementCacheTypeStat('authorCrit', hash, false);
                return cachedAuthorTest;
            } else {
                await this.subredditStats.incrementCacheTypeStat('authorCrit', hash, true);
                cachedAuthorTest = await this.isAuthor(item, authorOpts, include);
                cachedAuthorTest.criteria = cloneDeep(authorOptsObj);
                await this.cache.set(hash, cachedAuthorTest, {ttl: this.ttl.filterCriteriaTTL});
                return cachedAuthorTest;
            }
        }

        const res = await this.isAuthor(item, authorOpts, include);
        res.criteria = cloneDeep(authorOptsObj);
        return res;
    }

    async testItemCriteria(i: (Comment | Submission), activityStateObj: NamedCriteria<TypedActivityState>, logger: Logger, include = true, source?: ActivitySourceValue): Promise<FilterCriteriaResult<TypedActivityState>> {
        const {criteria: activityState} = activityStateObj;
        if(Object.keys(activityState).length === 0) {
            return {
                behavior: include ? 'include' : 'exclude',
                criteria: cloneDeep(activityStateObj),
                propertyResults: [],
                passed: true
            }
        }
        if (this.ttl.filterCriteriaTTL !== false) {
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
                let itemResult = await this.cache.get(hash) as FilterCriteriaResult<TypedActivityState> | undefined | null;
                if (itemResult !== undefined && itemResult !== null) {
                    await this.subredditStats.incrementCacheTypeStat('itemCrit', hash, false);
                    logger.debug(`Cache Hit: Item Check on ${item.name} (Hash ${hash})`);
                    //return cachedItem as boolean;
                } else {
                    await this.subredditStats.incrementCacheTypeStat('itemCrit', hash, true);
                    itemResult = await this.isItem(item, state, logger, include);
                }
                await this.cache.set(hash, itemResult, {ttl: this.ttl.filterCriteriaTTL});

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

    async isItem (item: Submission | Comment, stateCriteria: TypedActivityState, logger: Logger, include: boolean, source?: ActivitySourceValue): Promise<FilterCriteriaResult<(SubmissionState & CommentState)>> {

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

                            const itemSource = new ActivitySource(source);

                            const requestedSourcesVal: string[] = !Array.isArray(itemOptVal) ? [itemOptVal] as string[] : itemOptVal as string[];
                            const requestedSources = requestedSourcesVal.map(x => new ActivitySource(x));

                            propResultsMap.source!.passed = criteriaPassWithIncludeBehavior(requestedSources.some(x => x.matches(itemSource)), include);
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
                    case 'createdOn':
                        const createdAt = dayjs.unix(await item.created);
                        propResultsMap.createdOn!.found = createdAt.format('MMMM D, YYYY h:mm A Z');
                        propResultsMap.createdOn!.passed = false;

                        const expressions = Array.isArray(itemOptVal) ? itemOptVal as RelativeDateTimeMatch[] : [itemOptVal] as RelativeDateTimeMatch[];
                        try {
                            for (const expr of expressions) {
                                if (matchesRelativeDateTime(expr, createdAt)) {
                                    propResultsMap.createdOn!.passed = true;
                                    break;
                                }
                            }
                        } catch(err: any) {
                            propResultsMap.createdOn!.reason = err.message;
                        }
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
                                    if (testMaybeStringRegex(n, authorName)[0]) {
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
        let result = await this.cache.get(hash) as { id: string, results: (RuleResultEntity | RuleSetResultEntity)[], triggered: boolean } | undefined | null;
        if (result === null) {
            result = undefined;
        }
        if (result === undefined) {
            await this.subredditStats.incrementCacheTypeStat('commentCheck', hash, true);
            return result;
        }
        await this.subredditStats.incrementCacheTypeStat('commentCheck', hash, false);
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

    async getImageHash(img: ImageData): Promise<Required<ImageHashCacheData>|undefined> {

        if(img.hashResult !== undefined && img.hashResultFlipped !== undefined) {
            return img.toHashCache() as Required<ImageHashCacheData>;
        }

        const hash = `imgHash-${img.basePath}`;
        const result = await this.cache.get(hash) as string | undefined | null;
        if(result !== undefined && result !== null) {
            try {
                const data =  JSON.parse(result);
                if(asStrongImageHashCache(data)) {
                    await this.subredditStats.incrementCacheTypeStat('imageHash', hash, false);
                    return data;
                }
            } catch (e) {
                // had old values, just drop it
            }
        }
        await this.subredditStats.incrementCacheTypeStat('imageHash', hash, true);
        return undefined;
        // const hash = await this.cache.wrap(img.baseUrl, async () => await img.hash(true), { ttl }) as string;
        // if(img.hashResult === undefined) {
        //     img.hashResult = hash;
        // }
        // return hash;
    }

    async setImageHash(img: ImageData, ttl: number): Promise<void> {
        await this.cache.set(`imgHash-${img.basePath}`, img.toHashCache() as Required<ImageHashCacheData>, {ttl});
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

    async getSubredditRemovalReasons(): Promise<SubredditRemovalReason[]> {
        if(this.ttl.wikiTTL !== false) {
            return await this.cache.wrap(`removalReasons`, async () => {
                const res = await this.client.getSubredditRemovalReasons(this.subreddit.display_name);
                return Object.values(res.data);
            }, { ttl: this.ttl.wikiTTL }) as SubredditRemovalReason[];
        }
        const res = await this.client.getSubredditRemovalReasons(this.subreddit.display_name);
        return Object.values(res.data);
    }

    async getSubredditRemovalReasonById(id: string): Promise<SubredditRemovalReason | undefined> {
        return (await this.getSubredditRemovalReasons()).find(x => x.id === id);
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

export const checkItemFilter = async (item: (Submission | Comment), filter: ItemOptions, resources: SubredditResources, options?: {logger?: Logger, source?: ActivitySourceValue, includeIdentifier?: boolean}): Promise<[boolean, ('inclusive' | 'exclusive' | undefined), FilterResult<TypedActivityState>]> => {

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

export const checkCommentSubmissionStates = async (item: Comment, submissionStates: SubmissionState[], resources: SubredditResources, logger: Logger, source?: ActivitySourceValue, excludeCondition?: JoinOperands): Promise<[boolean, FilterCriteriaPropertyResult<CommentState>]> => {
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
