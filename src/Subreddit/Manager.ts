import Snoowrap, {Comment, Subreddit, WikiPage} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    asComment,
    asSubmission,
    cacheStats,
    createHistoricalStatsDisplay,
    createRetryHandler,
    determineNewResults,
    findLastIndex,
    formatNumber, getActivityAuthorName, isComment, isSubmission, likelyJson5,
    mergeArr, normalizeName,
    parseFromJsonOrYamlToObject,
    parseRedditEntity,
    pollingInfo,
    resultsSummary,
    sleep,
    totalFromMapStats,
    triggeredIndicator,
} from "../util";
import {RuleResult} from "../Rule";
import {ConfigBuilder, buildPollingOptions} from "../ConfigBuilder";
import {
    ActionedEvent,
    ActionResult,
    ActivityDispatch,
    ActivitySource,
    CheckResult,
    CheckSummary,
    DEFAULT_POLLING_INTERVAL,
    DEFAULT_POLLING_LIMIT,
    FilterCriteriaDefaults,
    Invokee,
    LogInfo,
    ManagerOptions,
    ManagerStateChangeOption,
    ManagerStats,
    NotificationEventPayload,
    PAUSED,
    PollingOptionsStrong,
    PollOn,
    PostBehavior,
    PostBehaviorTypes, DispatchAudit,
    DispatchSource,
    RUNNING,
    RunResult,
    RunState,
    STOPPED,
    SYSTEM,
    USER
} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
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
import {JSONConfig} from "../JsonConfig";
import {Check, CheckStructuredJson} from "../Check";
import NotificationManager from "../Notification/NotificationManager";
import {createHistoricalDefaults, historicalDefaults} from "../Common/defaults";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";
import {CMError, isRateLimitError, isStatusError, RunProcessingError} from "../Utils/Errors";
import {ErrorWithCause, stackWithCauses} from "pony-cause";
import {Run} from "../Run";
import got from "got";
import {Bot as BotEntity} from "../Common/Entities/Bot";
import {Manager as ManagerEntity} from "../Common/Entities/Manager";

export interface RunningState {
    state: RunState,
    causedBy: Invokee
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
    dispatchSource?: DispatchAudit
}

export interface CheckTask {
    activity: (Submission | Comment),
    options: runCheckOptions
}

export interface RuntimeManagerOptions extends ManagerOptions {
    sharedStreams?: PollOn[];
    wikiLocation?: string;
    botName?: string;
    maxWorkers?: number;
    maxGotoDepth?: number
    botEntity: BotEntity
    managerEntity: ManagerEntity
}

interface QueuedIdentifier {
    id: string,
    shouldRefresh: boolean
    state: 'queued' | 'processing'
}

export class Manager extends EventEmitter {
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
    running: boolean = false;
    manuallyStopped: boolean = false;
    eventsState: RunningState = {
        state: STOPPED,
        causedBy: SYSTEM
    };
    queueState: RunningState = {
        state: STOPPED,
        causedBy: SYSTEM
    };
    botState: RunningState = {
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
    actionedEvents: ActionedEvent[] = [];

    processEmitter: EventEmitter = new EventEmitter();

    getStats = async (): Promise<ManagerStats> => {
        const data: any = {
            eventsAvg: formatNumber(this.eventsRollingAvg),
            rulesAvg: formatNumber(this.rulesUniqueRollingAvg),
            historical: {
                lastReload: createHistoricalStatsDisplay(createHistoricalDefaults()),
                allTime: createHistoricalStatsDisplay(createHistoricalDefaults()),
            },
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
                permalink: x.activity.permalink,
                submissionId: asComment(x.activity) ? x.activity.link_id : undefined,
                author: getActivityAuthorName(x.activity.author),
                queuedAt: x.queuedAt,
                durationMilli: x.duration.asMilliseconds(),
                duration: x.duration.humanize(),
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
                this.logs = [log, ...this.logs].slice(0, 301);
            }
        });
        this.globalDryRun = dryRun;
        this.wikiLocation = wikiLocation;
        this.filterCriteriaDefaults = filterCriteriaDefaults;
        this.postCheckBehaviorDefaults = postCheckBehaviorDefaults;
        this.sharedStreams = sharedStreams;
        this.pollingRetryHandler = createRetryHandler({maxRequestRetry: 3, maxOtherRetry: 2}, this.logger);
        this.subreddit = sub;
        this.botEntity = botEntity;
        this.managerEntity = managerEntity;
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
                const et = self.resources !== undefined ? self.resources.stats.historical.allTime.eventsCheckedTotal : 0;
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
                const rt = self.resources !== undefined ? self.resources.stats.historical.allTime.rulesRunTotal - self.resources.stats.historical.allTime.rulesCachedTotal : 0;
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
            const queuedItemIndex = findLastIndex(this.queuedItemsMeta, x => x.id === task.activity.id);
            if(queuedItemIndex !== -1) {
                const itemMeta = this.queuedItemsMeta[queuedItemIndex];
                let msg = `Item ${itemMeta.id} is already ${itemMeta.state}.`;
                if(itemMeta.state === 'queued') {
                    this.logger.debug(`${msg} Flagging to refresh data before processing.`);
                    this.queuedItemsMeta.splice(queuedItemIndex, 1, {...itemMeta, shouldRefresh: true});
                } else {
                    this.logger.debug(`${msg} Re-queuing item but will also refresh data before processing.`);
                    this.queuedItemsMeta.push({id: task.activity.id, shouldRefresh: true, state: 'queued'});
                    this.queue.push(task);
                }
            } else {
                this.queuedItemsMeta.push({id: task.activity.id, shouldRefresh: false, state: 'queued'});
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
                    this.logger.debug(`Cancelling existing delayed activities due to activity being queued from non-dispatch sources: ${existingDelayedToCancel.map((x, index) => `[${index + 1}] Queued At ${dayjs.unix(x.queuedAt).format('YYYY-MM-DD HH:mm:ssZ')} for ${x.duration.humanize()}`).join(' ')}`);
                    const toCancelIds = existingDelayedToCancel.map(x => x.id);
                    this.resources.delayedItems.filter(x => !toCancelIds.includes(x.id));
                }
            }
        }
        , 1);
    }

    protected async startDelayQueue() {
        while(this.queueState.state === RUNNING) {
            let index = 0;
            for(const ar of this.resources.delayedItems) {
                if(!ar.processing && dayjs.unix(ar.queuedAt).add(ar.duration.asMilliseconds(), 'milliseconds').isSameOrBefore(dayjs())) {
                    this.logger.info(`Delayed Activity ${ar.activity.name} is being queued.`);
                    const dispatchStr: DispatchSource = ar.identifier === undefined ? 'dispatch' : `dispatch:${ar.identifier}`;
                    await this.firehose.push({activity: ar.activity, options: {refresh: true, source: dispatchStr, initialGoto: ar.goto, dispatchSource: {id: ar.id, queuedAt: ar.queuedAt, delay: ar.duration.humanize(), action: ar.action, goto: ar.goto, identifier: ar.identifier}}});
                    this.resources.delayedItems.splice(index, 1, {...ar, processing: true});
                }
                index++;
            }
            // sleep for 5 seconds
            await sleep(5000);
        }
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

                const queuedItemIndex = this.queuedItemsMeta.findIndex(x => x.id === task.activity.id);
                try {
                    const itemMeta = this.queuedItemsMeta[queuedItemIndex];
                    this.queuedItemsMeta.splice(queuedItemIndex, 1, {...itemMeta, state: 'processing'});
                    await this.handleActivity(task.activity, {refresh: itemMeta.shouldRefresh, ...task.options});
                } finally {
                    // always remove item meta regardless of success or failure since we are done with it meow
                    this.queuedItemsMeta.splice(queuedItemIndex, 1);
                    if(task.options.dispatchSource?.id !== undefined) {
                        const delayIndex = this.resources.delayedItems.findIndex(x => x.id === task.options.dispatchSource?.id);
                        this.resources.delayedItems.splice(delayIndex, 1);
                    }
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
            const {checks, ...configManagerOpts} = validJson;
            const {
                polling = [{pollOn: 'unmoderated', limit: DEFAULT_POLLING_LIMIT, interval: DEFAULT_POLLING_INTERVAL}],
                caching,
                credentials,
                dryRun,
                footer,
                nickname,
                notifications,
                queue: {
                    maxWorkers = undefined,
                } = {},
            } = configManagerOpts || {};
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

            let resourceConfig: SubredditResourceConfig = {
                footer,
                logger: this.logger,
                subreddit: this.subreddit,
                caching,
                credentials,
                client: this.client,
                botEntity: this.botEntity,
                managerEntity: this.managerEntity,
            };
            this.resources = await this.cacheManager.set(this.subreddit.display_name, resourceConfig);
            this.resources.setLogger(this.logger);

            this.logger.info('Subreddit-specific options updated');
            this.logger.info('Building Runs and Checks...');

            const structuredRuns = configBuilder.parseToStructured(validJson, this.filterCriteriaDefaults, this.postCheckBehaviorDefaults);

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
        let item = activity;
        const itemId = await item.id;

        if(await this.resources.hasRecentSelf(item)) {
            const {force = false} = options;
            let recentMsg = `Found in Activities recently (last ${this.resources.selfTTL} seconds) modified/created by this bot`;
            if(force) {
                this.logger.debug(`${recentMsg} but will run anyway because "force" option was true.`);
            } else {
                this.logger.debug(`${recentMsg} so will skip running.`);
                return;
            }
        }

        const {
            delayUntil,
            refresh = false,
            initialGoto = '',
            dispatchSource,
        } = options;

        let allRuleResults: RuleResult[] = [];
        const runResults: RunResult[] = [];
        const itemIdentifiers = [];
        itemIdentifiers.push(`${checkType === 'Submission' ? 'SUB' : 'COM'} ${itemId}`);
        this.currentLabels = itemIdentifiers;
        let ePeek = '';
        let peekParts: ItemContent;
        try {
            const [peek, { content: peekContent }] = await itemContentPeek(item);
            ePeek = peekContent;
            const dispatchStr = dispatchSource !== undefined ? ` (Dispatched by ${dispatchSource.action}${dispatchSource.identifier !== undefined ? ` | ${dispatchSource.identifier}` : ''}) ${peek}` : peek;
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
            dispatchSource: dispatchSource,
            timestamp: Date.now(),
            runResults: []
        }
        const startingApiLimit = this.client.ratelimitRemaining;

        let wasRefreshed = false;

        try {

            if (delayUntil !== undefined) {
                const created = dayjs.unix(item.created_utc);
                const diff = dayjs().diff(created, 's');
                if (diff < delayUntil) {
                    this.logger.verbose(`Delaying processing until Activity is ${delayUntil} seconds old (${delayUntil - diff}s)`);
                    await sleep(delayUntil - diff);
                    // @ts-ignore
                    item = await activity.refresh();
                    wasRefreshed = true;
                }
            }
            // refresh signal from firehose if activity was ingested multiple times before processing or re-queued while processing
            // want to make sure we have the most recent data
            if(!wasRefreshed && refresh === true) {
                this.logger.verbose(`Refreshed data ${dispatchSource !== undefined ? 'b/c activity is from dispatch' : 'b/c activity was delayed'}`);
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

                const [runResult, postBehavior] = await currRun.handle(item,allRuleResults, runResults.filter(x => x.name === currRun.name), {...options, gotoContext, maxGotoDepth: this.maxGotoDepth});
                runResults.push(runResult);

                allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, (runResult.checkResults ?? []).map(x => x.ruleResults).flat()));

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
            this.emit('error', err);
        } finally {
            actionedEvent.triggered = runResults.some(x => x.triggered);
            if(!actionedEvent.triggered) {
                this.logger.verbose('No checks triggered');
            }
            try {
                //actionedEvent.actionResults = runActions;
                actionedEvent.runResults = runResults;
                if(actionedEvent.triggered) {
                    // only get parent submission info if we are actually going to use this event
                    if(checkType === 'Comment') {
                        try {
                            // @ts-ignore
                            const subProxy = await this.client.getSubmission(await item.link_id);
                            const sub = await this.resources.getActivity(subProxy);
                            const [peek, { content: peekContent, author, permalink }] = await itemContentPeek(sub);
                            actionedEvent.parentSubmission = {
                                peek: peekContent,
                                author,
                                subreddit: item.subreddit_name_prefixed,
                                id: (item as Comment).link_id,
                                type: 'comment',
                                link: permalink
                            }
                        } catch (err: any) {
                            this.logger.error(`Error occurred while generating item peek for ${checkType} Activity ${itemId}`, err);
                        }
                    }
                    await this.resources.addActionedEvent(actionedEvent);
                }

                const checksRun = actionedEvent.runResults.map(x => x.checkResults).flat().length;
                let actionsRun = actionedEvent.runResults.map(x => x.checkResults?.map(y => y.actionResults)).flat().length;
                let totalRulesRun = actionedEvent.runResults.map(x => x.checkResults?.map(y => y.ruleResults)).flat().length;

                this.logger.verbose(`Run Stats:        Checks ${checksRun} | Rules => Total: ${totalRulesRun} Unique: ${allRuleResults.length} Cached: ${totalRulesRun - allRuleResults.length} Rolling Avg: ~${formatNumber(this.rulesUniqueRollingAvg)}/s | Actions ${actionsRun}`);
                this.logger.verbose(`Reddit API Stats: Initial ${startingApiLimit} | Current ${this.client.ratelimitRemaining} | Used ~${startingApiLimit - this.client.ratelimitRemaining} | Events ~${formatNumber(this.eventsRollingAvg)}/s`);
                this.currentLabels = [];
            } catch (err: any) {
                this.logger.error(new ErrorWithCause('Error occurred while cleaning up Activity check and generating stats', {cause: err}));
            } finally {
                this.resources.updateHistoricalStats({
                    eventsCheckedTotal: 1,
                    eventsActionedTotal: actionedEvent.triggered ? 1 : 0,
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
                        this.firehose.push({activity: item, options: {delayUntil, source: `poll:${source}`}})
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

    startQueue(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(this.queueState.state === RUNNING) {
            this.logger.info(`Activity processing queue is already RUNNING with (${this.queue.length()} queued activities)`);
        } else if (!this.validConfigLoaded) {
            this.logger.warn('Cannot start activity processing queue while manager has an invalid configuration');
        } else {
            if(this.queueState.state === STOPPED) {
                // extra precaution to make sure queue meta is cleared before starting queue
                this.queuedItemsMeta = [];
            }
            this.queue.resume();
            this.firehose.resume();
            this.logger.info(`Activity processing queue started RUNNING with ${this.queue.length()} queued activities`);
            this.queueState = {
                state: RUNNING,
                causedBy
            }
            this.startDelayQueue();
            if(!suppressNotification) {
                this.notificationManager.handle('runStateChanged', 'Queue Started', reason, causedBy);
            }
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
        }

        this.logger.info('Event polling STARTED');
        this.eventsState = {
            state: RUNNING,
            causedBy
        }
        if(!suppressNotification) {
            this.notificationManager.handle('runStateChanged', 'Events Polling Started', reason, causedBy)
        }
    }

    pauseEvents(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
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
        }
    }

    stopEvents(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
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
        } else if(causedBy !== this.eventsState.causedBy) {
            this.logger.info(`Events STOPPED by ${causedBy}`);
            this.logger.info('Note: Polling behavior will be re-built from configuration when next started');
            this.eventsState.causedBy = causedBy;
        } else {
            this.logger.info('Events already STOPPED');
        }
    }

    async start(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(!this.validConfigLoaded) {
            this.logger.warn('Cannot put bot in RUNNING state while manager has an invalid configuration');
            return;
        }
        await this.startEvents(causedBy, {suppressNotification: true});
        this.startQueue(causedBy, {suppressNotification: true});
        this.botState = {
            state: RUNNING,
            causedBy
        }
        if(!suppressNotification) {
            this.notificationManager.handle('runStateChanged', 'Bot Started', reason, causedBy)
        }
    }

    async stop(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        this.stopEvents(causedBy, {suppressNotification: true});
        await this.stopQueue(causedBy, {suppressNotification: true});
        this.botState = {
            state: STOPPED,
            causedBy
        }
        if(!suppressNotification) {
            this.notificationManager.handle('runStateChanged', 'Bot Stopped', reason, causedBy)
        }
    }
}
