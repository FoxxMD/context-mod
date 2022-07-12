import Snoowrap, {WikiPage} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    asComment,
    asSubmission,
    cacheStats,
    createRetryHandler,
    determineNewResults,
    findLastIndex,
    formatNumber, frequencyEqualOrLargerThanMin, getActivityAuthorName, isComment, isSubmission, likelyJson5,
    mergeArr, normalizeName,
    parseRedditEntity,
    pollingInfo,
    resultsSummary,
    sleep,
    totalFromMapStats,
    triggeredIndicator,
} from "../util";
import {ConfigBuilder, buildPollingOptions} from "../ConfigBuilder";
import {
    ActionedEvent,
    ActionResult,
    ActivityDispatch,
    CheckResult,
    CheckSummary,
    DEFAULT_POLLING_INTERVAL,
    DEFAULT_POLLING_LIMIT,
    LogInfo,
    ManagerOptions,
    ManagerStateChangeOption,
    ManagerStats,
    NotificationEventPayload,
    PAUSED,
    PollingOptionsStrong,
    PostBehavior,
    ActivitySourceData,
    RUNNING,
    RunResult,
    STOPPED,
    SYSTEM,
    USER, RuleResult, DatabaseStatisticsOperatorConfig
} from "../Common/interfaces";
import {Submission, Comment, Subreddit} from 'snoowrap/dist/objects';
import {activityIsRemoved, ItemContent, itemContentPeek} from "../Utils/SnoowrapUtils";
import LoggedError from "../Utils/LoggedError";
import {
    BotResourcesManager,
    SubredditResourceConfig,
    SubredditResources,
    SubredditResourceSetOptions
} from "./SubredditResources";
import {SPoll, UnmoderatedStream, ModQueueStream, SubmissionStream, CommentStream} from "./Streams";
import EventEmitter from "events";
import ConfigParseError from "../Utils/ConfigParseError";
import dayjs, {Dayjs as DayjsObj} from "dayjs";
import Action from "../Action";
import {queue, QueueObject} from 'async';
import {SubredditConfigHydratedData, SubredditConfigData} from "../SubredditConfigData";
import NotificationManager from "../Notification/NotificationManager";
import {createHistoricalDisplayDefaults} from "../Common/defaults";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";
import {
    CMError,
    definesSeriousError,
    isRateLimitError,
    isSeriousError,
    isStatusError,
    RunProcessingError
} from "../Utils/Errors";
import {ErrorWithCause, stackWithCauses} from "pony-cause";
import {Run} from "../Run";
import got from "got";
import {Bot as BotEntity} from "../Common/Entities/Bot";
import {ManagerEntity as ManagerEntity, RunningStateEntities} from "../Common/Entities/ManagerEntity";
import {isRuleSet} from "../Rule/RuleSet";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {RunResultEntity} from "../Common/Entities/RunResultEntity";
import {Repository} from "typeorm";
import {Activity} from "../Common/Entities/Activity";
import { AuthorEntity } from "../Common/Entities/AuthorEntity";
import {CMEvent} from "../Common/Entities/CMEvent";
import {nanoid} from "nanoid";
import {ActivitySourceEntity} from "../Common/Entities/ActivitySourceEntity";
import {InvokeeType} from "../Common/Entities/InvokeeType";
import {RunStateType} from "../Common/Entities/RunStateType";
import {EntityRunState} from "../Common/Entities/EntityRunState/EntityRunState";
import {
    ActivitySource,
    DispatchSource,
    EventRetentionPolicyRange,
    Invokee,
    PollOn,
    recordOutputTypes,
    RunState
} from "../Common/Infrastructure/Atomic";
import {parseFromJsonOrYamlToObject} from "../Common/Config/ConfigUtil";
import {FilterCriteriaDefaults} from "../Common/Infrastructure/Filters/FilterShapes";
import {InfluxClient} from "../Common/Influx/InfluxClient";
import { Point } from "@influxdata/influxdb-client";

export interface RunningState {
    state: RunState,
    causedBy: Invokee
}

export type RunningStateTypes = 'managerState' | 'eventsState' | 'queueState';

export type RunningStates = {
    [key in RunningStateTypes]: RunningState
}

export interface runCheckOptions {
    checkNames?: string[],
    delayUntil?: number,
    dryRun?: boolean,
    refresh?: boolean,
    force?: boolean,
    gotoContext?: string
    maxGotoDepth?: number
    source: ActivitySource
    initialGoto?: string
    activitySource: ActivitySourceData
    disableDispatchDelays?: boolean
}

export interface CheckTask {
    activity: (Submission | Comment),
    options: runCheckOptions
}

export interface RuntimeManagerOptions extends Omit<ManagerOptions, 'filterCriteriaDefaults'> {
    sharedStreams?: PollOn[];
    wikiLocation?: string;
    botName?: string;
    maxWorkers?: number;
    maxGotoDepth?: number
    botEntity: BotEntity
    managerEntity: ManagerEntity
    filterCriteriaDefaults?: FilterCriteriaDefaults
    statDefaults: DatabaseStatisticsOperatorConfig
    influxClients: InfluxClient[]
}

interface QueuedIdentifier {
    id: string,
    shouldRefresh: boolean
    state: 'queued' | 'processing'
}

export class Manager extends EventEmitter implements RunningStates {
    subreddit: Subreddit;
    botEntity: BotEntity;
    managerEntity: ManagerEntity;
    client: ExtendedSnoowrap;
    logger: Logger;
    logs: LogInfo[] = [];
    botName: string;
    pollOptions: PollingOptionsStrong[] = [];
    get submissionChecks() {
        return this.runs.map(x => x.submissionChecks).flat();
    }
    get commentChecks() {
        return this.runs.map(x => x.commentChecks).flat();
    }
    runs: Run[] = []
    resources!: SubredditResources;
    wikiLocation: string;
    lastWikiRevision?: DayjsObj
    lastWikiCheck: DayjsObj = dayjs();
    wikiFormat: ('yaml' | 'json') = 'yaml';
    filterCriteriaDefaults?: FilterCriteriaDefaults
    postCheckBehaviorDefaults?: PostBehavior
    statDefaults: DatabaseStatisticsOperatorConfig
    retentionOverride?: EventRetentionPolicyRange
    //wikiUpdateRunning: boolean = false;

    streams: Map<string, SPoll<Snoowrap.Submission | Snoowrap.Comment>> = new Map();
    sharedStreamCallbacks: Map<string, any> = new Map();
    pollingRetryHandler: Function;
    dryRun?: boolean;
    sharedStreams: PollOn[];
    cacheManager: BotResourcesManager;
    globalDryRun?: boolean;
    queue: QueueObject<CheckTask>;
    // firehose is used to ensure all activities from different polling streams are unique
    // that is -- if the same activities is in both modqueue and unmoderated we don't want to process the activity twice or use stale data
    //
    // so all activities get queued to firehose, it keeps track of items by id (using queuedItemsMeta)
    // and ensures that if any activities are ingested while they are ALSO currently queued or working then they are properly handled by either
    // 1) if queued, do not re-queue but instead tell worker to refresh before processing
    // 2) if currently processing then re-queue but also refresh before processing
    firehose: QueueObject<CheckTask>;
    queuedItemsMeta: QueuedIdentifier[] = [];
    globalMaxWorkers: number;
    subMaxWorkers?: number;
    maxGotoDepth: number;

    displayLabel: string;
    currentLabels: string[] = [];

    startedAt?: DayjsObj;
    validConfigLoaded: boolean = false;

    eventsState: RunningState = {
        state: STOPPED,
        causedBy: SYSTEM
    };
    queueState: RunningState = {
        state: STOPPED,
        causedBy: SYSTEM
    };
    managerState: RunningState = {
        state: STOPPED,
        causedBy: SYSTEM
    }

    notificationManager: NotificationManager;

    modPermissions?: string[]

    // use by api nanny to slow event consumption
    delayBy?: number;

    eventsSample: number[] = [];
    eventsSampleInterval: any;
    eventsRollingAvg: number = 0;
    rulesUniqueSample: number[] = [];
    rulesUniqueSampleInterval: any;
    rulesUniqueRollingAvg: number = 0;

    //seenWithNoReports: Set<string> = new Set();
    isMonitoringModqueue: boolean = false;
    modqueueInterval: number = 0;

    delayedQueueInterval: any;

    processEmitter: EventEmitter = new EventEmitter();

    activityRepo!: Repository<Activity>;
    authorRepo!: Repository<AuthorEntity>
    eventRepo!: Repository<CMEvent>;

    influxClients: InfluxClient[] = [];

    getStats = async (): Promise<ManagerStats> => {
        const data: any = {
            eventsAvg: formatNumber(this.eventsRollingAvg),
            rulesAvg: formatNumber(this.rulesUniqueRollingAvg),
            historical: createHistoricalDisplayDefaults(),
            cache: {
                provider: 'none',
                currentKeyCount: 0,
                isShared: false,
                totalRequests: 0,
                totalMiss: 0,
                missPercent: '0%',
                requestRate: 0,
                types: cacheStats()
            },
        };

        if (this.resources !== undefined) {
            const resStats = await this.resources.getStats();

            data.historical = this.resources.getHistoricalDisplayStats();
            data.cache = resStats.cache;
            data.cache.currentKeyCount = await this.resources.getCacheKeyCount();
            data.cache.isShared = this.resources.cacheSettingsHash === 'default';
            data.cache.provider = this.resources.cacheType;
        }
        return data;
    }

    getDelayedSummary = (): any[] => {
        if(this.resources === undefined) {
            return [];
        }
        return this.resources.delayedItems.map((x) => {
            return {
                id: x.id,
                activityId: x.activity.name,
                permalink: x.activity.permalink, // TODO construct this without having to fetch activity
                submissionId: asComment(x.activity) ? x.activity.link_id : undefined,
                author: x.author,
                queuedAt: x.queuedAt.unix(),
                duration: x.delay.asSeconds(),
                source: `${x.action}${x.identifier !== undefined ? ` (${x.identifier})` : ''}`,
                subreddit: this.subreddit.display_name_prefixed
            }
        });
    }

    getCurrentLabels = () => {
        return this.currentLabels;
    }

    getDisplay = () => {
        return this.displayLabel;
    }

    constructor(sub: Subreddit, client: ExtendedSnoowrap, logger: Logger, cacheManager: BotResourcesManager, opts: RuntimeManagerOptions) {
        super();

        const {
            dryRun,
            sharedStreams = [],
            wikiLocation = 'botconfig/contextbot',
            botName = 'ContextMod',
            maxWorkers = 1,
            maxGotoDepth = 1,
            filterCriteriaDefaults,
            postCheckBehaviorDefaults,
            botEntity,
            managerEntity,
            statDefaults,
            retention,
            influxClients,
        } = opts || {};
        this.displayLabel = opts.nickname || `${sub.display_name_prefixed}`;
        const getLabels = this.getCurrentLabels;
        const getDisplay = this.getDisplay;
        // dynamic default meta for winston feasible using function getters
        // https://github.com/winstonjs/winston/issues/1626#issuecomment-531142958
        this.logger = logger.child({
            get labels() {
                return getLabels()
            },
            get subreddit() {
                return getDisplay()
            }
        }, mergeArr);
        this.logger.stream().on('log', (log: LogInfo) => {
            if(log.subreddit !== undefined && log.subreddit === this.getDisplay()) {
                this.logs.unshift(log);
                if(this.logs.length > 300) {
                    // remove all elements starting from the 300th index (301st item)
                    this.logs.splice(300);
                }
            }
        });
        this.globalDryRun = dryRun;
        this.wikiLocation = wikiLocation;
        this.filterCriteriaDefaults = filterCriteriaDefaults;
        this.postCheckBehaviorDefaults = postCheckBehaviorDefaults;
        this.statDefaults = statDefaults;
        this.retentionOverride = retention;
        this.sharedStreams = sharedStreams;
        this.pollingRetryHandler = createRetryHandler({maxRequestRetry: 3, maxOtherRetry: 2}, this.logger);
        this.subreddit = sub;
        this.botEntity = botEntity;
        for(const client of influxClients) {
            this.influxClients.push(client.childClient(this.logger, {manager: this.displayLabel, subreddit: sub.display_name_prefixed}));
        }

        this.managerEntity = managerEntity;
        // always init in stopped state but use last invokee to determine if we should start the manager automatically afterwards
        this.eventsState = this.setInitialRunningState(managerEntity, 'eventsState');
        this.queueState = this.setInitialRunningState(managerEntity, 'queueState');
        this.managerState = this.setInitialRunningState(managerEntity, 'managerState');

        this.client = client;
        this.botName = botName;
        this.maxGotoDepth = maxGotoDepth;
        this.globalMaxWorkers = maxWorkers;
        this.notificationManager = new NotificationManager(this.logger, this.subreddit, this.displayLabel, botName);
        this.cacheManager = cacheManager;

        this.queue = this.generateQueue(this.getMaxWorkers(this.globalMaxWorkers));
        this.queue.pause();
        this.firehose = this.generateFirehose();

        this.logger.info(`Max GOTO Depth: ${this.maxGotoDepth}`);

        this.eventsSampleInterval = setInterval((function(self) {
            return function() {
                const et = self.resources !== undefined ? self.resources.stats.historical.eventsCheckedTotal : 0;
                const rollingSample = self.eventsSample.slice(0, 7)
                rollingSample.unshift(et)
                self.eventsSample = rollingSample;
                const diff = self.eventsSample.reduceRight((acc: number[], curr, index) => {
                    if(self.eventsSample[index + 1] !== undefined) {
                        const d = curr - self.eventsSample[index + 1];
                        if(d === 0) {
                            return [...acc, 0];
                        }
                        return [...acc, d/10];
                    }
                    return acc;
                }, []);
                self.eventsRollingAvg = diff.reduce((acc, curr) => acc + curr,0) / diff.length;
                //self.logger.debug(`Event Rolling Avg: ${formatNumber(self.eventsRollingAvg)}/s`);
            }
        })(this), 10000);

        this.rulesUniqueSampleInterval = setInterval((function(self) {
            return function() {
                const rollingSample = self.rulesUniqueSample.slice(0, 7)
                const rt = self.resources !== undefined ? self.resources.stats.historical.rulesRunTotal - self.resources.stats.historical.rulesCachedTotal : 0;
                rollingSample.unshift(rt);
                self.rulesUniqueSample = rollingSample;
                const diff = self.rulesUniqueSample.reduceRight((acc: number[], curr, index) => {
                    if(self.rulesUniqueSample[index + 1] !== undefined) {
                        const d = curr - self.rulesUniqueSample[index + 1];
                        if(d === 0) {
                            return [...acc, 0];
                        }
                        return [...acc, d/10];
                    }
                    return acc;
                }, []);
                self.rulesUniqueRollingAvg = diff.reduce((acc, curr) => acc + curr,0) / diff.length;
                //self.logger.debug(`Unique Rules Run Rolling Avg: ${formatNumber(self.rulesUniqueRollingAvg)}/s`);
            }
        })(this), 10000);

        this.delayedQueueInterval = setInterval((function(self) {
            return function() {
                if(!self.queue.paused && self.resources !== undefined) {
                    let index = 0;
                    let anyQueued = false;
                    for(const ar of self.resources.delayedItems) {
                        if(ar.queuedAt.add(ar.delay).isSameOrBefore(dayjs())) {
                            anyQueued = true;
                            self.logger.info(`Activity ${ar.activity.name} dispatched at ${ar.queuedAt.format('HH:mm:ss z')} (delayed for ${ar.delay.humanize()}) is now being queued.`, {leaf: 'Delayed Activities'});
                            self.firehose.push({
                                activity: ar.activity,
                                options: {
                                    refresh: true,
                                    // @ts-ignore
                                    source: ar.identifier === undefined ? ar.type : `${ar.type}:${ar.identifier}`,
                                    initialGoto: ar.goto,
                                    activitySource: {
                                        id: ar.id,
                                        queuedAt: ar.queuedAt,
                                        delay: ar.delay,
                                        action: ar.action,
                                        goto: ar.goto,
                                        identifier: ar.identifier,
                                        type: ar.type
                                    },
                                    dryRun: ar.dryRun,
                                }
                            });
                            self.resources.removeDelayedActivity(ar.id);
                        }
                        index++;
                    }
                    if(!anyQueued) {
                        self.logger.debug('No Activities ready to queue', {leaf: 'Delayed Activities'});
                    }
                }
            }
        })(this), 5000); // every 5 seconds

        this.processEmitter.on('notify', (payload: NotificationEventPayload) => {
           this.notificationManager.handle(payload.type, payload.title, payload.body, payload.causedBy, payload.logLevel);
        });

        // relay check/run errors to bot for retry metrics
        this.processEmitter.on('error', err => this.emit('error', err));
    }

    public async getModPermissions(): Promise<string[]> {
        if(this.modPermissions !== undefined) {
            return this.modPermissions as string[];
        }
        this.logger.debug('Retrieving mod permissions for bot');
        try {
            const userInfo = parseRedditEntity(this.botName, 'user');
            const mods = this.subreddit.getModerators({name: userInfo.name});
            // @ts-ignore
            this.modPermissions = mods[0].mod_permissions;
        } catch (e) {
            const err = new ErrorWithCause('Unable to retrieve moderator permissions', {cause: e});
            this.logger.error(err);
            return [];
        }
        return this.modPermissions as string[];
    }

    protected getMaxWorkers(subMaxWorkers?: number) {
        let maxWorkers = this.globalMaxWorkers;

        if (subMaxWorkers !== undefined) {
            if (subMaxWorkers > maxWorkers) {
                this.logger.warn(`Config specified ${subMaxWorkers} max queue workers but global max is set to ${this.globalMaxWorkers} -- will use global max`);
            } else {
                maxWorkers = subMaxWorkers;
            }
        }
        if (maxWorkers < 1) {
            this.logger.warn(`Max queue workers must be greater than or equal to 1, specified: ${maxWorkers}. Will use 1.`);
            maxWorkers = 1;
        }

        return maxWorkers;
    }

    protected generateFirehose() {
        return queue(async (task: CheckTask, cb) => {
            // items in queuedItemsMeta will be processing FIFO so earlier elements (by index) are older
            //
            // if we insert the same item again because it is currently being processed AND THEN we get the item AGAIN we only want to update the newest meta
            // so search the array backwards to get the neweset only
            const queuedItemIndex = findLastIndex(this.queuedItemsMeta, x => x.id === task.activity.name);
            if(queuedItemIndex !== -1) {
                const itemMeta = this.queuedItemsMeta[queuedItemIndex];
                let msg = `Item ${itemMeta.id} is already ${itemMeta.state}.`;
                if(itemMeta.state === 'queued') {
                    this.logger.debug(`${msg} Flagging to refresh data before processing.`);
                    this.queuedItemsMeta.splice(queuedItemIndex, 1, {...itemMeta, shouldRefresh: true});
                } else {
                    this.logger.debug(`${msg} Re-queuing item but will also refresh data before processing.`);
                    this.queuedItemsMeta.push({id: task.activity.name, shouldRefresh: true, state: 'queued'});
                    this.queue.push(task);
                }
            } else {
                this.queuedItemsMeta.push({id: task.activity.name, shouldRefresh: false, state: 'queued'});
                this.queue.push(task);
            }

            if(!task.options.source.includes('dispatch')) {
                // check for delayed items to cancel
                const existingDelayedToCancel = this.resources.delayedItems.filter(x => {
                    if (x.activity.name === task.activity.name) {
                        const {cancelIfQueued = false} = x;
                        if(cancelIfQueued === false) {
                            return false;
                        } else if (cancelIfQueued === true) {
                            return true;
                        } else {
                            const cancelFrom = !Array.isArray(cancelIfQueued) ? [cancelIfQueued] : cancelIfQueued;
                            return cancelFrom.map(x => x.toLowerCase()).includes(task.options.source.toLowerCase());
                        }
                    }
                });
                if(existingDelayedToCancel.length > 0) {
                    this.logger.debug(`Cancelling existing delayed activities due to activity being queued from non-dispatch sources: ${existingDelayedToCancel.map((x, index) => `[${index + 1}] Queued At ${x.queuedAt.format('YYYY-MM-DD HH:mm:ssZ')} for ${x.delay.humanize()}`).join(' ')}`);
                    const toCancelIds = existingDelayedToCancel.map(x => x.id);
                    for(const id of toCancelIds) {
                        await this.resources.removeDelayedActivity(id);
                    }
                }
            }
        }
        , 1);
    }

    protected generateQueue(maxWorkers: number) {
        if (maxWorkers > 1) {
            this.logger.warn(`Setting max queue workers above 1 (specified: ${maxWorkers}) may have detrimental effects to log readability and api usage. Consult the documentation before using this advanced/experimental feature.`);
        }

        const q = queue(async (task: CheckTask, cb) => {
                if (this.delayBy !== undefined) {
                    this.logger.debug(`SOFT API LIMIT MODE: Delaying Event run by ${this.delayBy} seconds`);
                    await sleep(this.delayBy * 1000);
                }

                const queuedItemIndex = this.queuedItemsMeta.findIndex(x => x.id === task.activity.name);
                try {
                    const itemMeta = this.queuedItemsMeta[queuedItemIndex];
                    this.queuedItemsMeta.splice(queuedItemIndex, 1, {...itemMeta, state: 'processing'});
                    await this.handleActivity(task.activity, {
                        refresh: itemMeta.shouldRefresh,
                        ...task.options,
                        // use dryRun specified in task options if it exists (usually from manual user invocation or from dispatched action)
                        dryRun: task.options.dryRun ?? this.dryRun
                    });
                } finally {
                    // always remove item meta regardless of success or failure since we are done with it meow
                    this.queuedItemsMeta.splice(queuedItemIndex, 1);
                }
            }
            , maxWorkers);
        q.error((err, task) => {
            this.logger.error('Encountered unhandled error while processing Activity, processing stopped early');
            this.logger.error(err);
        });
        q.drain(() => {
            this.logger.debug('All queued activities have been processed.');
        });

        this.logger.info(`Generated new Queue with ${maxWorkers} max workers`);
        return q;
    }

    public getCommentChecks() {
        return this.runs.map(x => x.commentChecks);
    }

    public getSubmissionChecks() {
        return this.runs.map(x => x.commentChecks);
    }

    protected async parseConfigurationFromObject(configObj: object, suppressChangeEvent: boolean = false) {
        try {
            const configBuilder = new ConfigBuilder({logger: this.logger});
            const validJson = configBuilder.validateJson(configObj);
            const {
                polling = [{pollOn: 'unmoderated', limit: DEFAULT_POLLING_LIMIT, interval: DEFAULT_POLLING_INTERVAL}],
                caching,
                credentials,
                dryRun,
                footer,
                nickname,
                databaseStatistics: {
                    frequency = this.statDefaults.frequency,
                } = {},
                notifications,
                retention,
                queue: {
                    maxWorkers = undefined,
                } = {},
            } = validJson || {};
            this.pollOptions = buildPollingOptions(polling);
            this.dryRun = this.globalDryRun || dryRun;

            this.displayLabel = nickname || `${this.subreddit.display_name_prefixed}`;

            if (footer !== undefined) {
                this.resources.footer = footer;
            }

            this.subMaxWorkers = maxWorkers;
            const realMax = this.getMaxWorkers(this.subMaxWorkers);
            if(realMax !== this.queue.concurrency) {
                this.queue = this.generateQueue(realMax);
                this.queue.pause();
            }

            this.logger.info(`Dry Run: ${this.dryRun === true}`);
            for (const p of this.pollOptions) {
                this.logger.info(`Polling Info => ${pollingInfo(p)}`)
            }

            this.notificationManager = new NotificationManager(this.logger, this.subreddit, this.displayLabel, this.botName, notifications);
            const {events, notifiers} = this.notificationManager.getStats();
            const notifierContent = notifiers.length === 0 ? 'None' : notifiers.join(', ');
            const eventContent = events.length === 0 ? 'None' : events.join(', ');
            this.logger.info(`Notification Info => Providers: ${notifierContent} | Events: ${eventContent}`);

            let realStatFrequency = frequency;
            if(realStatFrequency !== false && !frequencyEqualOrLargerThanMin(realStatFrequency, this.statDefaults.minFrequency)) {
                this.logger.warn(`Specified database statistic frequency of '${realStatFrequency}' is shorter than minimum enforced by operator of '${this.statDefaults.minFrequency}' -- will fallback to '${this.statDefaults.minFrequency}'`);
                realStatFrequency = this.statDefaults.minFrequency;
            }

            let resourceConfig: SubredditResourceConfig = {
                footer,
                logger: this.logger,
                subreddit: this.subreddit,
                caching,
                credentials,
                client: this.client,
                botEntity: this.botEntity,
                managerEntity: this.managerEntity,
                statFrequency: realStatFrequency,
                retention: this.retentionOverride ?? retention
            };
            this.resources = await this.cacheManager.set(this.subreddit.display_name, resourceConfig);
            this.resources.setLogger(this.logger);

            this.logger.info('Subreddit-specific options updated');
            this.logger.info('Building Runs and Checks...');

            const structuredRuns = await configBuilder.parseToStructured(validJson, this.resources, this.filterCriteriaDefaults, this.postCheckBehaviorDefaults);

            let runs: Run[] = [];

            // TODO check that bot has permissions for subreddit for all specified actions
            // can find permissions in this.subreddit.mod_permissions

            let index = 1;
            for (const r of structuredRuns) {
                const {name = `Run${index}`, ...rest} = r;
                const run = new Run({
                    name,
                    ...rest,
                    logger: this.logger,
                    resources: this.resources,
                    subredditName: this.subreddit.display_name,
                    client: this.client,
                    emitter: this.processEmitter,
                });
                runs.push(run);
                index++;
            }

            // make sure run names are unique
            const rNames: string[] = [];
            for(const r of runs) {
                if(rNames.includes(normalizeName(r.name))) {
                    throw new Error(`Rule names must be unique. Duplicate name detected: ${r.name}`);
                }
                rNames.push(normalizeName(r.name));
            }

            this.runs = runs;
            const runSummary = `Found ${runs.length} Runs with ${this.submissionChecks.length + this.commentChecks.length} Checks`;

            if(this.runs.length === 0) {
                this.logger.warn(runSummary);
            } else {
                this.logger.info(runSummary);
            }

            const checkSummary = `Found Checks -- Submission: ${this.submissionChecks.length} | Comment: ${this.commentChecks.length}`;
            if (this.submissionChecks.length === 0 && this.commentChecks.length === 0) {
                this.logger.warn(checkSummary);
            } else {
                this.logger.info(checkSummary);
            }
            this.validConfigLoaded = true;

            // make sure all db related stuff gets initialized
            for (const r of this.runs) {
                await r.initialize();
                for (const c of r.submissionChecks) {
                    await c.initialize();
                    for (const ru of c.rules) {
                        if (isRuleSet(ru)) {
                            for (const rule of ru.rules) {
                                await rule.initialize();
                            }
                        } else {
                            await ru.initialize();
                        }
                    }
                    for (const a of c.actions) {
                        await a.initialize();
                    }
                }
                for (const c of r.commentChecks) {
                    await c.initialize();
                    for (const ru of c.rules) {
                        if (isRuleSet(ru)) {
                            for (const rule of ru.rules) {
                                await rule.initialize();
                            }
                        } else {
                            await ru.initialize();
                        }
                    }
                    for (const a of c.actions) {
                        await a.initialize();
                    }
                }
            }

            if(this.eventsState.state === RUNNING) {
                // need to update polling, potentially
                await this.buildPolling();
                for(const stream of this.streams.values()) {
                    if(!stream.running) {
                        this.logger.debug(`Starting Polling for ${stream.name.toUpperCase()} ${stream.frequency / 1000}s interval`);
                        stream.startInterval();
                    }
                }
            }
            if(!suppressChangeEvent) {
                this.emit('configChange');
            }
        } catch (err: any) {
            this.validConfigLoaded = false;
            throw err;
        }
    }

    async parseConfiguration(causedBy: Invokee = 'system', force: boolean = false, options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false, suppressChangeEvent = false} = options || {};
        //this.wikiUpdateRunning = true;
        this.lastWikiCheck = dayjs();

        try {
            let sourceData: string;
            let wiki: WikiPage;
            try {
                try {
                    // @ts-ignore
                    wiki = await this.subreddit.getWikiPage(this.wikiLocation).fetch();
                } catch (err: any) {
                    if(isStatusError(err) && err.statusCode === 404) {
                        // see if we can create the page
                        if (!this.client.scope.includes('wikiedit')) {
                            throw new ErrorWithCause(`Page does not exist and could not be created because Bot does not have oauth permission 'wikiedit'`, {cause: err});
                        }
                        const modPermissions = await this.getModPermissions();
                        if (!modPermissions.includes('all') && !modPermissions.includes('wiki')) {
                            throw new ErrorWithCause(`Page does not exist and could not be created because Bot not have mod permissions for creating wiki pages. Must have 'all' or 'wiki'`, {cause: err});
                        }
                        if(!this.client.scope.includes('modwiki')) {
                            throw new ErrorWithCause(`Bot COULD create wiki config page but WILL NOT because it does not have the oauth permissions 'modwiki' which is required to set page visibility and editing permissions. Safety first!`, {cause: err});
                        }
                        // @ts-ignore
                        wiki = await this.subreddit.getWikiPage(this.wikiLocation).edit({
                            text: '',
                            reason: 'Empty configuration created for ContextMod'
                        });
                        this.logger.info(`Wiki page at ${this.wikiLocation} did not exist so bot created it!`);

                        // 0 = use subreddit wiki permissions
                        // 1 = only approved wiki contributors
                        // 2 = only mods may edit and view
                        // @ts-ignore
                        await this.subreddit.getWikiPage(this.wikiLocation).editSettings({
                            permissionLevel: 2,
                            // don't list this page on r/[subreddit]/wiki/pages
                            listed: false,
                        });
                        this.logger.info('Bot set wiki page visibility to MODS ONLY');
                    } else {
                        throw err;
                    }
                }
                const revisionDate = dayjs.unix(wiki.revision_date);
                if (!force && this.validConfigLoaded && (this.lastWikiRevision !== undefined && this.lastWikiRevision.isSame(revisionDate))) {
                    // nothing to do, we already have this revision
                    //this.wikiUpdateRunning = false;
                    if (force) {
                        this.logger.info('Config is up to date');
                    }
                    return false;
                }

                if (force) {
                    this.logger.info('Config update was forced');
                } else if (!this.validConfigLoaded) {
                    this.logger.info('Trying to load (new?) config now since there is no valid config loaded');
                } else if (this.lastWikiRevision !== undefined) {
                    this.logger.info(`Updating config due to stale wiki page (${dayjs.duration(dayjs().diff(revisionDate)).humanize()} old)`)
                }

                if(this.queueState.state === RUNNING) {
                    this.logger.verbose('Waiting for activity processing queue to pause before continuing config update');
                    await this.pauseQueue(causedBy);
                }

                this.lastWikiRevision = revisionDate;
                sourceData = await wiki.content_md;
            } catch (err: any) {
                let hint = '';
                if(isStatusError(err) && err.statusCode === 403) {
                    hint = ` -- HINT: Either the page is restricted to mods only and the bot's reddit account does have the mod permission 'all' or 'wiki' OR the bot does not have the 'wikiread' oauth permission`;
                }
                const msg = `Could not read wiki configuration. Please ensure the page https://reddit.com${this.subreddit.url}wiki/${this.wikiLocation} exists and is readable${hint}`;
                throw new ErrorWithCause(msg, {cause: err});
            }

            if (sourceData.replace('\r\n', '').trim() === '') {
                this.logger.error(`Wiki page contents was empty`);
                throw new ConfigParseError('Wiki page contents was empty');
            }

            const [format, configObj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(sourceData);
            this.wikiFormat = format;

            if (configObj === undefined) {
                this.logger.error(`Could not parse wiki page contents as JSON or YAML. Looks like it should be ${this.wikiFormat}?`);
                if (this.wikiFormat === 'json') {
                    this.logger.error(jsonErr);
                    this.logger.error('Check DEBUG output for yaml error');
                    this.logger.debug(yamlErr);
                } else {
                    this.logger.error(yamlErr);
                    this.logger.error('Check DEBUG output for json error');
                    this.logger.debug(jsonErr);
                }
                throw new ConfigParseError('Could not parse wiki page contents as JSON or YAML')
            }

            await this.parseConfigurationFromObject(configObj.toJS(), suppressChangeEvent);
            this.logger.info('Checks updated');

            if(!suppressNotification) {
                this.notificationManager.handle('configUpdated', 'Configuration Updated', reason, causedBy)
            }

            return true;
        } catch (err: any) {
            const error = new ErrorWithCause('Failed to parse subreddit configuration', {cause: err});
            // @ts-ignore
           //error.logged = true;
            this.logger.error(error);
            this.validConfigLoaded = false;
            throw error;
        }
    }

    async handleActivity(activity: (Submission | Comment), options: runCheckOptions): Promise<void> {
        const checkType = isSubmission(activity) ? 'Submission' : 'Comment';
        let item = activity,
            runtimeShouldRefresh = false;

        const {
            delayUntil,
            refresh = false,
            initialGoto = '',
            activitySource,
            force = false,
        } = options;

        const event = new CMEvent();

        if(refresh) {
            this.logger.verbose(`Refreshed data`);
            // @ts-ignore
            item = await activity.refresh();
        }

        let activityEntity: Activity;
        const existingEntity = await this.activityRepo.findOneBy({_id: item.name});


        /**
         * Report Tracking
         *
         * Store ids for activities that do not have any reports so that if that changes we can be sure activity had no reports at last modqueue poll interval
         *
         * Only do this if modqueue is being monitored otherwise its useless since we'll never see the event again
         * */

        // #1 if never seen before and only one report AND source is modqueue
        // --> we know it was last interval for sure
        // --> and store last seen so if we see again we know last interval

        // #2 if never seen before and more than one report
        // --> don't know which was "new", need to store all rough
        // --> and store last seen so if we see again we know last interval

        // #3 if never seen before and no reports
        // --> then store last seen so if we see again we know last interval BUT don't need to store b/c...
        // --> if next seen in modqueue then #1
        // --> if not in modqueue we have last seen

        // #4 if seen before and one report and not modqueue
        // --> have last seen so we have at least a more narrow window than activity created at

        // #6 if seen before and more than one report and not already exists and not modqueue
        // --> outside of modqueue interval and don't have prior history so have to store everything rough

        // #7 if seen before and more than one report and modqueue
        // --> we know modqueue was started prior to seeing this first time so we can use last interval

        // #2
        // #4
        // #6
        let lastKnownStateTimestamp = await this.resources.getActivityLastSeenDate(item.name);
        if(lastKnownStateTimestamp !== undefined && lastKnownStateTimestamp.isBefore(this.startedAt)) {
            // if we last saw this activity BEFORE we started event polling (modqueue) then it's not useful to us
            lastKnownStateTimestamp = undefined;
        }
        // #2
        // #3
        // #6
        await this.resources.setActivityLastSeenDate(item.name);

        // if modqueue is running then we know we are checking for new reports every X seconds
        if(options.activitySource.identifier === 'modqueue') {
            // #1 if the activity is from modqueue and only has one report then we know that report was just created
            if(item.num_reports === 1
                // #7 otherwise if it has more than one report AND we have seen it -- its only seen if it has already been stored (in below block) --
                // then we are reasonably sure that any reports created were in the last X seconds
                || (item.num_reports > 1 && lastKnownStateTimestamp !== undefined)) {

                lastKnownStateTimestamp = dayjs().subtract(this.modqueueInterval, 'seconds');
            }
        }
        // if activity is not from modqueue then known good timestamps for "time between last known report and now" is reliant on these things:
        // 1) (most accurate) lastKnownStateTimestamp -- only available if activity either had 0 reports OR 1+ and existing reports have been stored (see below code)
        // 2) last stored report time from Activity
        // 3) create date of activity

        let shouldPersistReports = false;

        if (existingEntity === null) {
            activityEntity = Activity.fromSnoowrapActivity(this.managerEntity.subreddit, activity, lastKnownStateTimestamp);
            // always store if any reports exist and modqueue is being monitored (no reason to store if not monitoring, things would be too inaccurate)
            if (item.num_reports > 0 /*&& this.isMonitoringModqueue*/) {
                shouldPersistReports = true;
            }
        } else {
            activityEntity = existingEntity;
            // will always persist if reports need to be updated and modqueue is being monitored (no reason to store if not monitoring, things would be too inaccurate)
            if (activityEntity.syncReports(item, lastKnownStateTimestamp) /*&& this.isMonitoringModqueue*/) {
                shouldPersistReports = true;
            }
        }

        if (shouldPersistReports) {
            activityEntity = await this.activityRepo.save(activityEntity);
        }

        const itemId = await item.id;

        if(await this.resources.hasRecentSelf(item)) {
            let recentMsg = `Found in Activities recently (last ${this.resources.selfTTL} seconds) modified/created by this bot`;
            if(force) {
                this.logger.debug(`${recentMsg} but will run anyway because "force" option was true.`);
            } else {
                this.logger.debug(`${recentMsg} so will skip running.`);
                return;
            }
        }

        event.triggered = false;
        event.manager = this.managerEntity;
        event.activity = activityEntity;
        event.runResults = [];
        event.queuedAt = dayjs(options.activitySource.queuedAt);
        event.source = new ActivitySourceEntity({...options.activitySource, manager: this.managerEntity});


        let allRuleResults: RuleResultEntity[] = [];
        const runResults: RunResultEntity[] = [];
        const itemIdentifiers = [];
        itemIdentifiers.push(`${checkType === 'Submission' ? 'SUB' : 'COM'} ${itemId}`);
        this.currentLabels = itemIdentifiers;
        let ePeek = '';
        let peekParts: ItemContent;
        try {
            const [peek, { content: peekContent }] = await itemContentPeek(item);
            ePeek = peekContent;
            const dispatchStr = activitySource !== undefined ? ` (Dispatched by ${activitySource.action}${activitySource.identifier !== undefined ? ` | ${activitySource.identifier}` : ''}) ${peek}` : peek;
            this.logger.info(`<EVENT> ${dispatchStr}`);
        } catch (err: any) {
            this.logger.error(`Error occurred while generating item peek for ${checkType} Activity ${itemId}`, err);
        }

        let actionedEvent: ActionedEvent = {
            triggered: false,
            subreddit: this.subreddit.display_name,
            activity: {
                peek: ePeek,
                link: item.permalink,
                type: checkType === 'Submission' ? 'submission' : 'comment',
                id: itemId,
                author: item.author.name,
                subreddit: item.subreddit_name_prefixed
            },
            dispatchSource: activitySource,
            timestamp: Date.now(),
            runResults: []
        }
        const startingApiLimit = this.client.ratelimitRemaining;

        try {

            if (delayUntil !== undefined) {
                const created = dayjs.unix(item.created_utc);
                const diff = dayjs().diff(created, 's');
                if (diff < delayUntil) {
                    let delayMsg = `Activity should be ${delayUntil} seconds old before processing but is only ${diff} seconds old.`;
                    const remaining = delayUntil - diff;
                    if(remaining > 2) {
                        // if activity should be delayed and amount of time to wait is non-trivial then we don't want to block the worker
                        // so instead we will dispatch activity and re-process it later
                        this.logger.verbose(`${delayMsg} Delay time remaining (${remaining}s) is non-trivial (more than 2 seconds) so activity will be re-queued to prevent blocking worker.`);
                        await this.resources.addDelayedActivity({
                            ...options.activitySource,
                            cancelIfQueued: true,
                            delay: dayjs.duration(remaining, 'seconds'),
                            id: 'notUsed',
                            queuedAt: dayjs(),
                            activity,
                            author: getActivityAuthorName(activity.author),
                        });
                        return;
                    } else {
                        this.logger.verbose(`${delayMsg} Waiting ${remaining} second before processing, then refreshing data`);
                        await sleep(remaining * 1000);
                        runtimeShouldRefresh = true;
                    }
                }
            }
            // refresh signal from firehose if activity was ingested multiple times before processing or re-queued while processing
            // want to make sure we have the most recent data
            if(runtimeShouldRefresh) {
                this.logger.verbose(`Refreshed data`);
                // @ts-ignore
                item = await activity.refresh();
            }

            if (asSubmission(item)) {
                if (await item.removed_by_category === 'deleted') {
                    this.logger.warn('Submission was deleted, cannot process.');
                    return;
                }
            } else if (item.author.name === '[deleted]') {
                this.logger.warn('Comment was deleted, cannot process.');
                return;
            }

            // for now disallow the same goto from being run twice
            // maybe in the future this can be user-configurable
            const hitGotos: string[] = [];

            let continueRunIteration = true;
            let runIndex = 0;
            let gotoContext: string = initialGoto;
            while(continueRunIteration && (runIndex < this.runs.length || gotoContext !== '')) {
                let currRun: Run;
                if(gotoContext !== '') {
                    hitGotos.push(gotoContext);
                    if(hitGotos.filter(x => x === gotoContext).length > this.maxGotoDepth) {
                        throw new Error(`The goto "${gotoContext}" has been triggered ${hitGotos.filter(x => x === gotoContext).length} times which is more than the max allowed for any single goto (${this.maxGotoDepth}).
                         This indicates a possible endless loop may occur so CM will terminate processing this activity to save you from yourself! The max triggered depth can be configured by the operator.`);
                    }
                    const [runName] = gotoContext.split('.');
                    const gotoIndex = this.runs.findIndex(x => normalizeName(x.name) === normalizeName(runName));
                    if(gotoIndex !== -1) {
                        if(gotoIndex > runIndex) {
                            this.logger.debug(`Fast forwarding Run iteration to ${this.runs[gotoIndex].name}`, {leaf: 'GOTO'});
                        } else if(gotoIndex < runIndex) {
                            this.logger.debug(`Rewinding Run iteration to ${this.runs[gotoIndex].name}`, {leaf: 'GOTO'});
                        } else {
                            this.logger.debug(`Did not iterate to next Run due to GOTO specifying same run`, {leaf: 'GOTO'});
                        }
                        currRun = this.runs[gotoIndex];
                        runIndex = gotoIndex;
                        if(!gotoContext.includes('.')) {
                            // goto completed, no check
                            gotoContext = '';
                        }
                    } else {
                        throw new Error(`GOTO specified a Run that could not be found: ${runName}`);
                    }
                } else {
                    currRun = this.runs[runIndex];
                }

                const [runResult, postBehavior] = await currRun.handle(item,allRuleResults, runResults.filter(x => x.run.name === currRun.name), {...options, gotoContext, maxGotoDepth: this.maxGotoDepth});
                runResults.push(runResult);

                allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, (runResult.checkResults ?? []).map(x => x.allRuleResults ?? []).flat()));

                switch (postBehavior.toLowerCase()) {
                    case 'next':
                    case 'nextrun':
                        continueRunIteration = true;
                        gotoContext = '';
                        break;
                    case 'stop':
                        continueRunIteration = false;
                        gotoContext = '';
                        break;
                    default:
                        if (postBehavior.includes('goto:')) {
                            gotoContext = postBehavior.split(':')[1];
                        }
                }
                runIndex++;
            }
        } catch (err: any) {
            if(err instanceof RunProcessingError && err.result !== undefined) {
                runResults.push(err.result);
            }
            const processError = new ErrorWithCause('Activity processing terminated early due to unexpected error', {cause: err});
            this.logger.error(processError);
            if(isSeriousError(err)) {
                this.emit('error', err);
            }
        } finally {
            event.triggered = runResults.some(x => x.triggered);
            actionedEvent.triggered = runResults.some(x => x.triggered);
            event.runResults = runResults;
            if(!actionedEvent.triggered) {
                this.logger.verbose('No checks triggered');
            }

            try {
                //actionedEvent.actionResults = runActions;
                event.runResults = runResults;
                //actionedEvent.runResults = runResults;

                const checksRun = actionedEvent.runResults.map(x => x.checkResults).flat().length;
                let actionsRun = actionedEvent.runResults.map(x => x.checkResults?.map(y => y.actionResults)).flat().length;
                let totalRulesRun = actionedEvent.runResults.map(x => x.checkResults?.map(y => y.ruleResults)).flat(5).length;

                // determine if event should be recorded
                const allOutputs = [...new Set(runResults.map(x => x.checkResults.map(y => y.recordOutputs ?? [])).flat(2).filter(x => recordOutputTypes.includes(x)))];
                if(allOutputs.length > 0) {
                    if(allOutputs.includes('database')) {
                        // only get parent submission info if we are actually going to use this event
                        if(checkType === 'Comment') {
                            try {
                                let subActivity: Activity | null = await this.activityRepo.findOneBy({_id: (item as Comment).link_id});
                                if(subActivity === null) {
                                    // @ts-ignore
                                    const subProxy = await this.client.getSubmission((item as Comment).link_id);
                                    const sub = await this.resources.getActivity(subProxy);
                                    subActivity = await this.activityRepo.save(Activity.fromSnoowrapActivity(this.managerEntity.subreddit, sub));
                                }
                                event.activity.submission = subActivity;

                                // const [peek, { content: peekContent, author, permalink }] = await itemContentPeek(sub);
                                // actionedEvent.parentSubmission = {
                                //     peek: peekContent,
                                //     author,
                                //     subreddit: item.subreddit_name_prefixed,
                                //     id: (item as Comment).link_id,
                                //     type: 'comment',
                                //     link: permalink
                                // }
                            } catch (err: any) {
                                this.logger.error(`Error occurred while generating item peek for ${checkType} Activity ${itemId}`, err);
                            }
                        }
                        await this.eventRepo.save(event);
                    }
                    if (allOutputs.includes('influx') && this.influxClients.length > 0) {
                        try {
                            const time = dayjs().valueOf()

                            const measurements: Point[] = [];

                            measurements.push(new Point('event')
                                .timestamp(time)
                                .tag('triggered', event.triggered ? '1' : '0')
                                .tag('activityType', isSubmission(item) ? 'submission' : 'comment')
                                .tag('sourceIdentifier', event.source.identifier ?? 'unknown')
                                .tag('sourceType', event.source.type)
                                .stringField('eventId', event.id)
                                .stringField('activityId', event.activity.id)
                                .stringField('author', actionedEvent.activity.author)
                                .intField('processingTime', time - event.processedAt.valueOf())
                                .intField('queuedTime', event.processedAt.valueOf() - event.queuedAt.valueOf())
                                .intField('runsProcessed', actionedEvent.runResults.length)
                                .intField('runsTriggered', actionedEvent.runResults.filter(x => x.triggered).length)
                                .intField('checksProcessed', checksRun)
                                .intField('checksTriggered', actionedEvent.runResults.map(x => x.checkResults).flat().filter(x => x.triggered).length)
                                .intField('totalRulesProcessed', totalRulesRun)
                                .intField('rulesTriggered', actionedEvent.runResults.map(x => x.checkResults?.map(y => y.ruleResults)).flat(5).filter((x: RuleResultEntity) => x.triggered === true).length)
                                .intField('uniqueRulesProcessed', allRuleResults.length)
                                .intField('cachedRulesProcessed', totalRulesRun - allRuleResults.length)
                                .intField('actionsProcessed', actionsRun)
                                .intField('apiUsage', startingApiLimit - this.client.ratelimitRemaining));

                            const defaultPoint = () => new Point('triggeredEntity')
                                .timestamp(time)
                                .tag('activityType', isSubmission(item) ? 'submission' : 'comment')
                                .tag('sourceIdentifier', event.source.identifier ?? 'unknown')
                                .tag('sourceType', event.source.type)
                                .stringField('activityId', event.activity.id)
                                .stringField('author', actionedEvent.activity.author)
                                .stringField('eventId', event.id);

                            for (const r of event.runResults) {
                                if (r.triggered) {
                                    measurements.push(defaultPoint()
                                        .tag('entityType', 'run')
                                        .tag('name', r.run.name));
                                    for (const c of r.checkResults) {
                                        if (c.triggered) {
                                            measurements.push(defaultPoint()
                                                .tag('entityType', 'check')
                                                .stringField('name', c.check.name)
                                                .tag('fromCache', c.fromCache ? '1' : '0'));

                                            if (c.ruleResults !== undefined) {
                                                for (const ru of c.ruleResults) {
                                                    if (ru.result.triggered) {
                                                        measurements.push(defaultPoint()
                                                            .tag('entityType', 'rule')
                                                            .stringField('name', ru.result.premise.name)
                                                            .tag('fromCache', ru.result.fromCache ? '1' : '0'))
                                                    }
                                                }
                                            }
                                            if (c.ruleSetResults !== undefined) {
                                                for (const rs of c.ruleSetResults) {
                                                    if (rs.result.triggered) {
                                                        measurements.push(defaultPoint()
                                                            .tag('entityType', 'ruleSet'));
                                                        for (const ru of rs.result.results) {
                                                            if (ru.triggered) {
                                                                measurements.push(defaultPoint()
                                                                    .tag('entityType', 'rule')
                                                                    .stringField('name', ru.premise.name))
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            if (c.actionResults !== undefined) {
                                                for (const a of c.actionResults) {
                                                    if (a.run) {
                                                        measurements.push(defaultPoint()
                                                            .tag('entityType', 'action')
                                                            .stringField('name', a.premise.name)
                                                            .tag('dryRun', a.dryRun ? '1' : '0')
                                                            .tag('succes', a.success ? '1' : '0')
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            for (const client of this.influxClients) {
                                await client.writePoint(measurements);
                            }
                        } catch (e: any) {
                            this.logger.error(new CMError('Error occurred while building or sending Influx data', {
                                cause: e,
                                isSerious: false
                            }));
                        }
                    }
                }

                this.logger.verbose(`Run Stats:        Checks ${checksRun} | Rules => Total: ${totalRulesRun} Unique: ${allRuleResults.length} Cached: ${totalRulesRun - allRuleResults.length} Rolling Avg: ~${formatNumber(this.rulesUniqueRollingAvg)}/s | Actions ${actionsRun}`);
                this.logger.verbose(`Reddit API Stats: Initial ${startingApiLimit} | Current ${this.client.ratelimitRemaining} | Used ~${startingApiLimit - this.client.ratelimitRemaining} | Events ~${formatNumber(this.eventsRollingAvg)}/s`);
                this.currentLabels = [];
            } catch (err: any) {
                this.logger.error(new ErrorWithCause('Error occurred while cleaning up Activity check and generating stats', {cause: err}));
            } finally {
                this.resources.updateHistoricalStats({
                    eventsCheckedTotal: 1,
                    eventsActionedTotal: event.triggered ? 1 : 0,
                });
            }
        }
    }

    isPollingShared(streamName: string): boolean {
        const pollOption = this.pollOptions.find(x => x.pollOn === streamName);
        return pollOption !== undefined && pollOption.limit === DEFAULT_POLLING_LIMIT && pollOption.interval === DEFAULT_POLLING_INTERVAL && this.sharedStreams.includes(streamName as PollOn);
    }

    async buildPolling() {

        const sources: PollOn[] = ['unmoderated', 'modqueue', 'newComm', 'newSub'];

        const subName = this.subreddit.display_name;

        for (const source of sources) {

            if (!sources.includes(source)) {
                this.logger.error(`'${source}' is not a valid polling source. Valid sources: unmoderated | modqueue | newComm | newSub`);
                continue;
            }

            const pollOpt = this.pollOptions.find(x => x.pollOn.toLowerCase() === source.toLowerCase());
            if (pollOpt === undefined) {
                if(this.sharedStreamCallbacks.has(source)) {
                    this.logger.debug(`Removing listener for shared polling on ${source.toUpperCase()} because it no longer exists in config`);
                    this.sharedStreamCallbacks.delete(source);
                }
                const existingStream = this.streams.get(source);
                if (existingStream !== undefined) {
                    this.logger.debug(`Stopping polling on ${source.toUpperCase()} because it no longer exists in config`);
                    existingStream.end();
                    this.streams.delete(source);
                }
            } else {

                const {
                    limit,
                    interval,
                    delayUntil,
                } = pollOpt;
                let stream: SPoll<Snoowrap.Submission | Snoowrap.Comment>;
                let modStreamType: string | undefined;

                switch (source) {
                    case 'unmoderated':
                        if (limit === DEFAULT_POLLING_LIMIT && interval === DEFAULT_POLLING_INTERVAL && this.sharedStreams.includes(source)) {
                            modStreamType = 'unmoderated';
                            // use default mod stream from resources
                            stream = this.cacheManager.modStreams.get('unmoderated') as SPoll<Snoowrap.Submission | Snoowrap.Comment>;
                        } else {
                            stream = new UnmoderatedStream(this.client, {
                                subreddit: this.subreddit.display_name,
                                limit: limit,
                                pollTime: interval * 1000,
                                logger: this.logger,
                            });
                        }
                        break;
                    case 'modqueue':
                        if (limit === DEFAULT_POLLING_LIMIT && interval === DEFAULT_POLLING_INTERVAL && this.sharedStreams.includes(source)) {
                            modStreamType = 'modqueue';
                            // use default mod stream from resources
                            stream = this.cacheManager.modStreams.get('modqueue') as SPoll<Snoowrap.Submission | Snoowrap.Comment>;
                        } else {
                            stream = new ModQueueStream(this.client, {
                                subreddit: this.subreddit.display_name,
                                limit: limit,
                                pollTime: interval * 1000,
                                logger: this.logger,
                            });
                        }
                        break;
                    case 'newSub':
                        if (limit === DEFAULT_POLLING_LIMIT && interval === DEFAULT_POLLING_INTERVAL && this.sharedStreams.includes(source)) {
                            modStreamType = 'newSub';
                            // use default mod stream from resources
                            stream = this.cacheManager.modStreams.get('newSub') as SPoll<Snoowrap.Submission | Snoowrap.Comment>;
                        } else {
                            stream = new SubmissionStream(this.client, {
                                subreddit: this.subreddit.display_name,
                                limit: limit,
                                pollTime: interval * 1000,
                                logger: this.logger,
                            });
                        }
                        break;
                    case 'newComm':
                        if (limit === DEFAULT_POLLING_LIMIT && interval === DEFAULT_POLLING_INTERVAL && this.sharedStreams.includes(source)) {
                            modStreamType = 'newComm';
                            // use default mod stream from resources
                            stream = this.cacheManager.modStreams.get('newComm') as SPoll<Snoowrap.Submission | Snoowrap.Comment>;
                        } else {
                            stream = new CommentStream(this.client, {
                                subreddit: this.subreddit.display_name,
                                limit: limit,
                                pollTime: interval * 1000,
                                logger: this.logger,
                            });
                        }
                        break;
                }

                if (stream === undefined) {
                    this.logger.error(`Should have found polling source for '${source}' but it did not exist for some reason!`);
                    continue;
                }

                const onItem = (source: PollOn) => async (item: Comment | Submission) => {
                    if (item.subreddit.display_name !== subName || this.eventsState.state !== RUNNING) {
                        return;
                    }
                    let checkType: 'Submission' | 'Comment' | undefined;
                    if (item instanceof Submission) {
                        if (this.submissionChecks.length > 0) {
                            checkType = 'Submission';
                        }
                    } else if (this.commentChecks.length > 0) {
                        checkType = 'Comment';
                    }
                    if (checkType !== undefined) {
                        this.firehose.push({
                            activity: item, options: {
                                delayUntil,
                                source: `poll:${source}`,
                                activitySource: {
                                    queuedAt: dayjs(),
                                    type: 'poll',
                                    identifier: source,
                                    id: nanoid(16)
                                }
                            }
                        })
                    }
                };

                if (modStreamType !== undefined) {
                    let removedOwn = false;
                    const existingStream = this.streams.get(source);
                    if(existingStream !== undefined) {
                        existingStream.end();
                        this.streams.delete(source);
                        removedOwn = true;
                    }
                    if(!this.sharedStreamCallbacks.has(source)) {
                        stream.once('listing', this.noChecksWarning(source));
                        this.logger.debug(`${removedOwn ? 'Stopped own polling and replace with ' : 'Set '}listener on shared polling ${source}`);
                    }
                    this.sharedStreamCallbacks.set(source, onItem(source));
                } else {
                    let ownPollingMsgParts: string[] = [];
                    let removedShared = false;
                    if(this.sharedStreamCallbacks.has(source)) {
                        removedShared = true;
                        this.sharedStreamCallbacks.delete(source);
                        ownPollingMsgParts.push('removed shared polling listener');
                    }

                    const existingStream = this.streams.get(source);
                    let processed;
                    if (existingStream !== undefined) {
                        ownPollingMsgParts.push('replaced existing');
                        processed = existingStream.processed;
                        existingStream.end();
                    } else {
                        ownPollingMsgParts.push('create new');
                        stream.once('listing', this.noChecksWarning(source));
                    }

                    this.logger.debug(`Polling ${source.toUpperCase()} => ${ownPollingMsgParts.join('and')} dedicated stream`);

                    stream.on('item', onItem(source));
                    // @ts-ignore
                    stream.on('error', async (err: any) => {

                        this.emit('error', err);

                        const shouldRetry = await this.pollingRetryHandler(err);
                        if (shouldRetry) {
                            stream.startInterval(false, 'Within retry limits');
                        } else {
                            this.logger.warn('Stopping subreddit processing/polling due to too many errors');
                            await this.stop();
                        }
                    });

                    this.streams.set(source, stream);
                }
            }
        }
    }

    noChecksWarning = (source: PollOn) => (listing: any) => {
        if (this.commentChecks.length === 0 && ['modqueue', 'newComm'].some(x => x === source)) {
            this.logger.warn(`Polling '${source.toUpperCase()}' may return Comments but no comments checks were configured.`);
        }
        if (this.submissionChecks.length === 0 && ['unmoderated', 'modqueue', 'newSub'].some(x => x === source)) {
            this.logger.warn(`Polling '${source.toUpperCase()}' may return Submissions but no submission checks were configured.`);
        }
    }

    async startQueue(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {

        if(this.activityRepo === undefined) {
            this.activityRepo = this.resources.database.getRepository(Activity);
        }
        if(this.authorRepo === undefined) {
            this.authorRepo = this.resources.database.getRepository(AuthorEntity);
        }
        if(this.eventRepo === undefined) {
            this.eventRepo = this.resources.database.getRepository(CMEvent);
        }

        const {reason, suppressNotification = false} = options || {};
        if(this.queueState.state === RUNNING) {
            this.logger.info(`Activity processing queue is already RUNNING with (${this.queue.length()} queued activities)`);
        } else if (!this.validConfigLoaded) {
            this.logger.warn('Cannot start activity processing queue while manager has an invalid configuration');
        } else {
            this.queue.resume();
            this.firehose.resume();
            this.logger.info(`Activity processing queue started RUNNING with ${this.queue.length()} queued activities`);
            this.queueState = {
                state: RUNNING,
                causedBy
            }
            if(!suppressNotification) {
                this.notificationManager.handle('runStateChanged', 'Queue Started', reason, causedBy);
            }
            await this.syncRunningState('queueState');
        }
    }

    async pauseQueue(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(this.queueState.state === PAUSED) {
            if(this.queueState.causedBy !== causedBy) {
                this.logger.info(`Activity processing queue state set to PAUSED by ${causedBy}`);
                this.queueState = {
                    state: PAUSED,
                    causedBy
                }
                await this.syncRunningState('queueState');
            } else {
                this.logger.info('Activity processing queue already PAUSED');
            }
        } else if(this.queueState.state === STOPPED) {
            this.logger.info(`Activity processing queue must be in RUNNING state to pause`);
        } else {
            this.queue.pause();
            if(this.queue.running() === 0) {
                this.logger.info('Paused activity processing queue');
            } else {
                const pauseWaitStart = dayjs();
                this.logger.info(`Activity processing queue is pausing...waiting for ${this.queue.running()} activities to finish processing`);
                while (this.queue.running() > 0) {
                    await sleep(1500);
                    this.logger.verbose(`Activity processing queue is pausing...waiting for ${this.queue.running()} activities to finish processing`);
                }
                this.logger.info(`Activity processing queue paused (waited ${dayjs().diff(pauseWaitStart, 's')} seconds while activity processing finished)`);
            }
            this.queueState = {
                state: PAUSED,
                causedBy
            }
            if(!suppressNotification) {
                this.notificationManager.handle('runStateChanged', 'Queue Paused', reason, causedBy)
            }
            await this.syncRunningState('queueState');
        }
    }

    async stopQueue(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(this.queueState.state === STOPPED) {
            if(this.queueState.causedBy !== causedBy) {
                this.logger.info(`Activity processing queue state set to STOPPED by ${causedBy}`);
            } else {
                this.logger.info(`Activity processing queue is already STOPPED`);
            }
        } else {
            this.queue.pause();
            if(this.queue.running() === 0) {
                this.logger.info('Stopped activity processing queue');
            } else {
                const pauseWaitStart = dayjs();
                this.logger.info(`Activity processing queue is stopping...waiting for ${this.queue.running()} activities to finish processing`);
                const fullStopTime = dayjs().add(5, 'seconds');
                let gracefulStop = true;
                while (this.queue.running() > 0) {
                    gracefulStop = false;
                    if(dayjs().isAfter(fullStopTime)) {
                        break;
                    }
                    await sleep(1500);
                    this.logger.verbose(`Activity processing queue is stopping...waiting for ${this.queue.running()} activities to finish processing`);
                }
                if(!gracefulStop) {
                    this.logger.warn('Waited longer than 5 seconds to stop activities. Something isn\'t right so forcing stop :/ ');
                }
                this.logger.info(`Activity processing queue stopped by ${causedBy} and ${this.queue.length()} queued activities cleared (waited ${dayjs().diff(pauseWaitStart, 's')} seconds while activity processing finished)`);
                this.firehose.kill();
                this.queue.kill();
                this.queuedItemsMeta = [];
            }

            this.queueState = {
                state: STOPPED,
                causedBy
            }
            if(!suppressNotification) {
                this.notificationManager.handle('runStateChanged', 'Queue Stopped', reason, causedBy)
            }
            await this.syncRunningState('queueState');
        }
    }


    async startEvents(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(!this.validConfigLoaded) {
            this.logger.warn('Cannot start event polling while manager has an invalid configuration');
            return;
        }

        if(this.eventsState.state === RUNNING) {
            this.logger.info('Event polling already running');
        } else {
            if(this.eventsState.state === STOPPED) {
                await this.buildPolling();
            }

            if (this.submissionChecks.length === 0 && this.commentChecks.length === 0) {
                this.logger.warn('No submission or comment checks found!');
            }

            if (this.streams.size > 0) {
                this.logger.debug(`Starting own streams => ${[...this.streams.values()].map(x => `${x.name.toUpperCase()} ${x.frequency / 1000}s interval`).join(' | ')}`)
            }
            for (const s of this.streams.values()) {
                s.startInterval();
            }
            this.startedAt = dayjs();

            const modQueuePollOpts = this.pollOptions.find(x => x.pollOn === 'modqueue');
            if(modQueuePollOpts !== undefined) {
                this.isMonitoringModqueue = true;
                this.modqueueInterval = modQueuePollOpts.interval;
            }
        }

        this.logger.info('Event polling STARTED');
        this.eventsState = {
            state: RUNNING,
            causedBy
        }
        if(!suppressNotification) {
            this.notificationManager.handle('runStateChanged', 'Events Polling Started', reason, causedBy)
        }
        await this.syncRunningState('eventsState');
    }

    async pauseEvents(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(this.eventsState.state !== RUNNING) {
            this.logger.warn('Events must be in RUNNING state in order to be paused.');
        } else {
            this.eventsState = {
                state: PAUSED,
                causedBy
            };
            for(const s of this.streams.values()) {
                s.end();
            }
            if(causedBy === USER) {
                this.logger.info('Event polling is PAUSED. (Note: To change polling behavior you must first STOP event polling)')
            } else {
                this.logger.info('Event polling is PAUSED.');
            }
            if(!suppressNotification) {
                this.notificationManager.handle('runStateChanged', 'Events Polling Paused', reason, causedBy)
            }
            await this.syncRunningState('eventsState');
        }
        this.isMonitoringModqueue = false;
    }

    async stopEvents(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(this.eventsState.state !== STOPPED) {
            for (const s of this.streams.values()) {
                s.end();
            }
            this.streams = new Map();
            this.startedAt = undefined;
            this.logger.info(`Events STOPPED by ${causedBy}`);
            this.eventsState = {
                state: STOPPED,
                causedBy
            }
            this.logger.info('Note: Polling behavior will be re-built from configuration when next started');
            if(!suppressNotification) {
                this.notificationManager.handle('runStateChanged', 'Events Polling Stopped', reason, causedBy)
            }
            await this.syncRunningState('eventsState');
        } else if(causedBy !== this.eventsState.causedBy) {
            this.logger.info(`Events STOPPED by ${causedBy}`);
            this.logger.info('Note: Polling behavior will be re-built from configuration when next started');
            this.eventsState.causedBy = causedBy;
            await this.syncRunningState('eventsState');
        } else {
            this.logger.info('Events already STOPPED');
        }

        this.isMonitoringModqueue = false;
    }

    async start(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(!this.validConfigLoaded) {
            this.logger.warn('Cannot put bot in RUNNING state while manager has an invalid configuration');
            return;
        }
        await this.startEvents(causedBy, {suppressNotification: true});
        await this.startQueue(causedBy, {suppressNotification: true});
        this.managerState = {
            state: RUNNING,
            causedBy
        }
        if(!suppressNotification) {
            this.notificationManager.handle('runStateChanged', 'Bot Started', reason, causedBy)
        }
        await this.syncRunningState('managerState');
    }

    async stop(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        this.stopEvents(causedBy, {suppressNotification: true});
        await this.stopQueue(causedBy, {suppressNotification: true});
        this.managerState = {
            state: STOPPED,
            causedBy
        }
        if(!suppressNotification) {
            this.notificationManager.handle('runStateChanged', 'Bot Stopped', reason, causedBy)
        }
        await this.syncRunningState('managerState');
    }

    async destroy(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        await this.stop(causedBy, options);
        clearInterval(this.eventsSampleInterval);
        clearInterval(this.delayedQueueInterval);
        clearInterval(this.rulesUniqueSampleInterval)
        await this.cacheManager.destroy(this.subreddit.display_name);
    }

    setInitialRunningState(managerEntity: RunningStateEntities, type: RunningStateTypes): RunningState {
        if(managerEntity[type].runType.name === 'stopped' && managerEntity[type].invokee.name === 'user') {
            return {state: STOPPED, causedBy: 'user'};
        }
        return {state: STOPPED, causedBy: 'system'};
    }

    async syncRunningStates() {
        for(const s of ['managerState','eventsState','queueState'] as RunningStateTypes[]) {
            await this.syncRunningState(s);
        }
    }

    async syncRunningState(type: RunningStateTypes) {

        this.managerEntity[type].invokee = await this.cacheManager.invokeeRepo.findOneBy({name: this[type].causedBy}) as InvokeeType
        this.managerEntity[type].runType = await this.cacheManager.runTypeRepo.findOneBy({name: this[type].state}) as RunStateType

        await this.cacheManager.defaultDatabase.getRepository(ManagerEntity).save(this.managerEntity);
    }
}
