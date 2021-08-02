import Snoowrap, {Comment, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    cacheStats,
    createRetryHandler,
    determineNewResults, formatNumber,
    mergeArr, parseFromJsonOrYamlToObject, pollingInfo, sleep, totalFromMapStats,
} from "../util";
import {Poll} from "snoostorm";
import pEvent from "p-event";
import {RuleResult} from "../Rule";
import {ConfigBuilder, buildPollingOptions} from "../ConfigBuilder";
import {
    DEFAULT_POLLING_INTERVAL,
    DEFAULT_POLLING_LIMIT, Invokee,
    ManagerOptions, ManagerStateChangeOption, PAUSED,
    PollingOptionsStrong, RUNNING, RunState, STOPPED, SYSTEM, USER
} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import {activityIsRemoved, itemContentPeek} from "../Utils/SnoowrapUtils";
import LoggedError from "../Utils/LoggedError";
import ResourceManager, {
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
import {CheckStructuredJson} from "../Check";
import NotificationManager from "../Notification/NotificationManager";

export interface RunningState {
    state: RunState,
    causedBy: Invokee
}

export interface runCheckOptions {
    checkNames?: string[],
    delayUntil?: number,
    dryRun?: boolean,
}

export interface CheckTask {
    checkType: ('Comment' | 'Submission'),
    activity: (Submission | Comment),
    options?: runCheckOptions
}

export interface RuntimeManagerOptions extends ManagerOptions {
    sharedModqueue?: boolean;
    wikiLocation?: string;
    botName: string;
    maxWorkers: number;
}

export class Manager {
    subreddit: Subreddit;
    client: Snoowrap;
    logger: Logger;
    botName: string;
    pollOptions: PollingOptionsStrong[] = [];
    submissionChecks!: SubmissionCheck[];
    commentChecks!: CommentCheck[];
    resources!: SubredditResources;
    wikiLocation: string;
    lastWikiRevision?: DayjsObj
    lastWikiCheck: DayjsObj = dayjs();
    //wikiUpdateRunning: boolean = false;

    streamListedOnce: string[] = [];
    streams: SPoll<Snoowrap.Submission | Snoowrap.Comment>[] = [];
    modStreamCallbacks: Map<string, any> = new Map();
    dryRun?: boolean;
    sharedModqueue: boolean;
    globalDryRun?: boolean;
    emitter: EventEmitter = new EventEmitter();
    queue: QueueObject<CheckTask>;
    globalMaxWorkers: number;
    subMaxWorkers?: number;

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

    // use by api nanny to slow event consumption
    delayBy?: number;

    eventsCheckedTotal: number = 0;
    eventsCheckedSinceStartTotal: number = 0;
    eventsSample: number[] = [];
    eventsSampleInterval: any;
    eventsRollingAvg: number = 0;
    checksRunTotal: number = 0;
    checksRunSinceStartTotal: number = 0;
    checksTriggered: Map<string, number> = new Map();
    checksTriggeredSinceStart: Map<string, number> = new Map();
    rulesRunTotal: number = 0;
    rulesRunSinceStartTotal: number = 0;
    rulesCachedTotal: number = 0;
    rulesCachedSinceStartTotal: number = 0;
    rulesTriggeredTotal: number = 0;
    rulesTriggeredSinceStartTotal: number = 0;
    rulesUniqueSample: number[] = [];
    rulesUniqueSampleInterval: any;
    rulesUniqueRollingAvg: number = 0;
    actionsRun: Map<string, number> = new Map();
    actionsRunSinceStart: Map<string, number> = new Map();

    getStats = async () => {
        const data: any = {
            eventsCheckedTotal: this.eventsCheckedTotal,
            eventsCheckedSinceStartTotal: this.eventsCheckedSinceStartTotal,
            eventsAvg: formatNumber(this.eventsRollingAvg),
            checksRunTotal: this.checksRunTotal,
            checksRunSinceStartTotal: this.checksRunSinceStartTotal,
            checksTriggered: this.checksTriggered,
            checksTriggeredTotal: totalFromMapStats(this.checksTriggered),
            checksTriggeredSinceStart: this.checksTriggeredSinceStart,
            checksTriggeredSinceStartTotal: totalFromMapStats(this.checksTriggeredSinceStart),
            rulesRunTotal: this.rulesRunTotal,
            rulesRunSinceStartTotal: this.rulesRunSinceStartTotal,
            rulesCachedTotal: this.rulesCachedTotal,
            rulesCachedSinceStartTotal: this.rulesCachedSinceStartTotal,
            rulesTriggeredTotal: this.rulesTriggeredTotal,
            rulesTriggeredSinceStartTotal: this.rulesTriggeredSinceStartTotal,
            rulesAvg: formatNumber(this.rulesUniqueRollingAvg),
            actionsRun: this.actionsRun,
            actionsRunTotal: totalFromMapStats(this.actionsRun),
            actionsRunSinceStart: this.actionsRunSinceStart,
            actionsRunSinceStartTotal: totalFromMapStats(this.actionsRunSinceStart),
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
            const resStats = this.resources.getStats();

            data.cache = resStats.cache;
            data.cache.currentKeyCount = await this.resources.getCacheKeyCount();
            data.cache.isShared = this.resources.cacheSettingsHash === 'default';
            data.cache.provider = this.resources.cacheType;
        }
        return data;
    }

    getCurrentLabels = () => {
        return this.currentLabels;
    }

    getDisplay = () => {
        return this.displayLabel;
    }

    constructor(sub: Subreddit, client: Snoowrap, logger: Logger, opts: RuntimeManagerOptions = {botName: 'ContextMod', maxWorkers: 1}) {
        const {dryRun, sharedModqueue = false, wikiLocation = 'botconfig/contextbot', botName, maxWorkers} = opts;
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
        this.globalDryRun = dryRun;
        this.wikiLocation = wikiLocation;
        this.sharedModqueue = sharedModqueue;
        this.subreddit = sub;
        this.client = client;
        this.botName = botName;
        this.globalMaxWorkers = maxWorkers;
        this.notificationManager = new NotificationManager(this.logger, this.subreddit, this.displayLabel, botName);

        this.queue = this.generateQueue(this.getMaxWorkers(this.globalMaxWorkers));
        this.queue.pause();

        this.eventsSampleInterval = setInterval((function(self) {
            return function() {
                const rollingSample = self.eventsSample.slice(0, 7)
                rollingSample.unshift(self.eventsCheckedTotal)
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
                rollingSample.unshift(self.rulesRunTotal - self.rulesCachedTotal);
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

    protected generateQueue(maxWorkers: number) {
        if (maxWorkers > 1) {
            this.logger.warn(`Setting max queue workers above 1 (specified: ${maxWorkers}) may have detrimental effects to log readability and api usage. Consult the documentation before using this advanced/experimental feature.`);
        }

        const q = queue(async (task: CheckTask, cb) => {
                if (this.delayBy !== undefined) {
                    this.logger.debug(`SOFT API LIMIT MODE: Delaying Event run by ${this.delayBy} seconds`);
                    await sleep(this.delayBy * 1000);
                }
                await this.runChecks(task.checkType, task.activity, task.options);
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

    protected parseConfigurationFromObject(configObj: object) {
        try {
            const configBuilder = new ConfigBuilder({logger: this.logger});
            const validJson = configBuilder.validateJson(configObj);
            const {checks, ...configManagerOpts} = validJson;
            const {
                polling = [{pollOn: 'unmoderated', limit: DEFAULT_POLLING_LIMIT, interval: DEFAULT_POLLING_INTERVAL}],
                caching,
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
                caching
            };
            this.resources = ResourceManager.set(this.subreddit.display_name, resourceConfig);
            this.resources.setLogger(this.logger);

            this.logger.info('Subreddit-specific options updated');
            this.logger.info('Building Checks...');

            const commentChecks: Array<CommentCheck> = [];
            const subChecks: Array<SubmissionCheck> = [];
            const structuredChecks = configBuilder.parseToStructured(validJson);
            for (const jCheck of structuredChecks) {
                const checkConfig = {
                    ...jCheck,
                    dryRun: this.dryRun || jCheck.dryRun,
                    logger: this.logger,
                    subredditName: this.subreddit.display_name
                };
                if (jCheck.kind === 'comment') {
                    commentChecks.push(new CommentCheck(checkConfig));
                } else if (jCheck.kind === 'submission') {
                    subChecks.push(new SubmissionCheck(checkConfig));
                }
            }

            this.submissionChecks = subChecks;
            this.commentChecks = commentChecks;
            const checkSummary = `Found Checks -- Submission: ${this.submissionChecks.length} | Comment: ${this.commentChecks.length}`;
            if (subChecks.length === 0 && commentChecks.length === 0) {
                this.logger.warn(checkSummary);
            } else {
                this.logger.info(checkSummary);
            }
            this.validConfigLoaded = true;
        } catch (err) {
            this.validConfigLoaded = false;
            throw err;
        }
    }

    async parseConfiguration(causedBy: Invokee = 'system', force: boolean = false, options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        //this.wikiUpdateRunning = true;
        this.lastWikiCheck = dayjs();

        try {
            let sourceData: string;
            try {
                // @ts-ignore
                const wiki = await this.subreddit.getWikiPage(this.wikiLocation).fetch();
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
            } catch (err) {
                const msg = `Could not read wiki configuration. Please ensure the page https://reddit.com${this.subreddit.url}wiki/${this.wikiLocation} exists and is readable -- error: ${err.message}`;
                this.logger.error(msg);
                throw new ConfigParseError(msg);
            }

            if (sourceData === '') {
                this.logger.error(`Wiki page contents was empty`);
                throw new ConfigParseError('Wiki page contents was empty');
            }

            const [configObj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(sourceData);

            if (configObj === undefined) {
                this.logger.error(`Could not parse wiki page contents as JSON or YAML:`);
                this.logger.error(jsonErr);
                this.logger.error(yamlErr);
                throw new ConfigParseError('Could not parse wiki page contents as JSON or YAML')
            }

            this.parseConfigurationFromObject(configObj);
            this.logger.info('Checks updated');

            if(!suppressNotification) {
                this.notificationManager.handle('configUpdated', 'Configuration Updated', reason, causedBy)
            }

            return true;
        } catch (err) {
            this.validConfigLoaded = false;
            throw err;
        }
    }

    async runChecks(checkType: ('Comment' | 'Submission'), activity: (Submission | Comment), options?: runCheckOptions): Promise<void> {
        const checks = checkType === 'Comment' ? this.commentChecks : this.submissionChecks;
        let item = activity;
        this.eventsCheckedTotal++;
        this.eventsCheckedSinceStartTotal++;
        const itemId = await item.id;
        let allRuleResults: RuleResult[] = [];
        const itemIdentifier = `${checkType === 'Submission' ? 'SUB' : 'COM'} ${itemId}`;
        this.currentLabels = [itemIdentifier];
        let ePeek = '';
        try {
            const [peek, _] = await itemContentPeek(item);
            ePeek = peek;
            this.logger.info(`<EVENT> ${peek}`);
        } catch (err) {
            this.logger.error(`Error occurred while generate item peek for ${checkType} Activity ${itemId}`, err);
        }

        const {
            checkNames = [],
            delayUntil,
            dryRun,
        } = options || {};

        if (delayUntil !== undefined) {
            const created = dayjs.unix(item.created_utc);
            const diff = dayjs().diff(created, 's');
            if (diff < delayUntil) {
                this.logger.verbose(`Delaying processing until Activity is ${delayUntil} seconds old (${delayUntil - diff}s)`);
                await sleep(delayUntil - diff);
                // @ts-ignore
                item = await activity.refresh();
            }
        }

        const startingApiLimit = this.client.ratelimitRemaining;

        if (item instanceof Submission) {
            if (await item.removed_by_category === 'deleted') {
                this.logger.warn('Submission was deleted, cannot process.');
                return;
            }
        } else if (item.author.name === '[deleted]') {
            this.logger.warn('Comment was deleted, cannot process.');
            return;
        }

        let checksRun = 0;
        let actionsRun = 0;
        let totalRulesRun = 0;
        let runActions: Action[] = [];

        try {
            let triggered = false;
            for (const check of checks) {
                if (checkNames.length > 0 && !checkNames.map(x => x.toLowerCase()).some(x => x === check.name.toLowerCase())) {
                    this.logger.warn(`Check ${check.name} not in array of requested checks to run, skipping...`);
                    continue;
                }
                if(!check.enabled) {
                    this.logger.info(`Check ${check.name} is DISABLED, skipping...`);
                    continue;
                }
                checksRun++;
                triggered = false;
                let currentResults: RuleResult[] = [];
                try {
                    const [checkTriggered, checkResults] = await check.runRules(item, allRuleResults);
                    currentResults = checkResults;
                    totalRulesRun += checkResults.length;
                    allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, checkResults));
                    triggered = checkTriggered;
                } catch (e) {
                    if (e.logged !== true) {
                        this.logger.warn(`Running rules for Check ${check.name} failed due to uncaught exception`, e);
                    }
                }

                if (triggered) {
                    this.checksTriggered.set(check.name, (this.checksTriggered.get(check.name) || 0) + 1);
                    this.checksTriggeredSinceStart.set(check.name, (this.checksTriggeredSinceStart.get(check.name) || 0) + 1);
                    runActions = await check.runActions(item, currentResults.filter(x => x.triggered), dryRun);
                    actionsRun = runActions.length;

                    if(check.notifyOnTrigger) {
                        const ar = runActions.map(x => x.getActionUniqueName()).join(', ');
                        this.notificationManager.handle('eventActioned', 'Check Triggered', `Check "${check.name}" was triggered on Event: \n\n ${ePeek} \n\n with the following actions run: ${ar}`);
                    }
                    break;
                }
            }

            if (!triggered) {
                this.logger.info('No checks triggered');
            }

        } catch (err) {
            if (!(err instanceof LoggedError) && err.logged !== true) {
                this.logger.error('An unhandled error occurred while running checks', err);
            }
        } finally {
            try {
                const cachedTotal = totalRulesRun - allRuleResults.length;
                const triggeredRulesTotal = allRuleResults.filter(x => x.triggered).length;

                this.checksRunTotal += checksRun;
                this.checksRunSinceStartTotal += checksRun;
                this.rulesRunTotal += totalRulesRun;
                this.rulesRunSinceStartTotal += totalRulesRun;
                this.rulesCachedTotal += cachedTotal;
                this.rulesCachedSinceStartTotal += cachedTotal;
                this.rulesTriggeredTotal += triggeredRulesTotal;
                this.rulesTriggeredSinceStartTotal += triggeredRulesTotal;

                for (const a of runActions) {
                    const name = a.getActionUniqueName();
                    this.actionsRun.set(name, (this.actionsRun.get(name) || 0) + 1);
                    this.actionsRunSinceStart.set(name, (this.actionsRunSinceStart.get(name) || 0) + 1)
                }

                this.logger.verbose(`Run Stats:        Checks ${checksRun} | Rules => Total: ${totalRulesRun} Unique: ${allRuleResults.length} Cached: ${totalRulesRun - allRuleResults.length} Rolling Avg: ~${formatNumber(this.rulesUniqueRollingAvg)}/s | Actions ${actionsRun}`);
                this.logger.verbose(`Reddit API Stats: Initial ${startingApiLimit} | Current ${this.client.ratelimitRemaining} | Used ~${startingApiLimit - this.client.ratelimitRemaining} | Events ~${formatNumber(this.eventsRollingAvg)}/s`);
                this.currentLabels = [];
            } catch (err) {
                this.logger.error('Error occurred while cleaning up Activity check and generating stats', err);
            }
        }
    }

    async buildPolling() {
        // give current handle() time to stop
        //await sleep(1000);

        const retryHandler = createRetryHandler({maxRequestRetry: 5, maxOtherRetry: 1}, this.logger);

        const subName = this.subreddit.display_name;

        for (const pollOpt of this.pollOptions) {
            const {
                pollOn,
                limit,
                interval,
                delayUntil
            } = pollOpt;
            let stream: SPoll<Snoowrap.Submission | Snoowrap.Comment>;
            let modStreamType: string | undefined;

            switch (pollOn) {
                case 'unmoderated':
                    if (limit === DEFAULT_POLLING_LIMIT && interval === DEFAULT_POLLING_INTERVAL && this.sharedModqueue) {
                        modStreamType = 'unmoderated';
                        // use default mod stream from resources
                        stream = ResourceManager.modStreams.get('unmoderated') as SPoll<Snoowrap.Submission | Snoowrap.Comment>;
                    } else {
                        stream = new UnmoderatedStream(this.client, {
                            subreddit: this.subreddit.display_name,
                            limit: limit,
                            pollTime: interval * 1000,
                        });
                    }
                    break;
                case 'modqueue':
                    if (limit === DEFAULT_POLLING_LIMIT && interval === DEFAULT_POLLING_INTERVAL) {
                        modStreamType = 'modqueue';
                        // use default mod stream from resources
                        stream = ResourceManager.modStreams.get('modqueue') as SPoll<Snoowrap.Submission | Snoowrap.Comment>;
                    } else {
                        stream = new ModQueueStream(this.client, {
                            subreddit: this.subreddit.display_name,
                            limit: limit,
                            pollTime: interval * 1000,
                        });
                    }
                    break;
                case 'newSub':
                    stream = new SubmissionStream(this.client, {
                        subreddit: this.subreddit.display_name,
                        limit: limit,
                        pollTime: interval * 1000,
                    });
                    break;
                case 'newComm':
                    stream = new CommentStream(this.client, {
                        subreddit: this.subreddit.display_name,
                        limit: limit,
                        pollTime: interval * 1000,
                    });
                    break;
            }

            stream.once('listing', async (listing) => {
                if (!this.streamListedOnce.includes(pollOn)) {
                    // warning if poll event could potentially miss activities
                    if (this.commentChecks.length === 0 && ['unmoderated', 'modqueue', 'newComm'].some(x => x === pollOn)) {
                        this.logger.warn(`Polling '${pollOn}' may return Comments but no comments checks were configured.`);
                    }
                    if (this.submissionChecks.length === 0 && ['unmoderated', 'modqueue', 'newSub'].some(x => x === pollOn)) {
                        this.logger.warn(`Polling '${pollOn}' may return Submissions but no submission checks were configured.`);
                    }
                    this.streamListedOnce.push(pollOn);
                }
            });

            const onItem = async (item: Comment | Submission) => {
                if (!this.streamListedOnce.includes(pollOn)) {
                    return;
                }
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
                    this.queue.push({checkType, activity: item, options: {delayUntil}})
                }
            };

            stream.on('item', onItem);

            if (modStreamType !== undefined) {
                this.modStreamCallbacks.set(pollOn, onItem);
            } else {
                // @ts-ignore
                stream.on('error', async (err: any) => {

                    this.logger.error('Polling error occurred', err);
                    const shouldRetry = await retryHandler(err);
                    if (shouldRetry) {
                        stream.startInterval();
                    } else {
                        this.logger.warn('Pausing event polling due to too many errors');
                        await this.pauseEvents();
                    }
                });
                this.streams.push(stream);
            }
        }
    }

    async handle(): Promise<void> {
        if (this.submissionChecks.length === 0 && this.commentChecks.length === 0) {
            this.logger.warn('No submission or comment checks to run! Bot will not run.');
            return;
        }

        try {
            for (const s of this.streams) {
                s.startInterval();
            }
            this.startedAt = dayjs();
            this.running = true;
            this.manuallyStopped = false;
            this.logger.info('Bot Running');

            await pEvent(this.emitter, 'end');
        } catch (err) {
            this.logger.error('Too many request errors occurred or an unhandled error was encountered, manager is stopping');
        } finally {
            this.stop();
        }
    }

    startQueue(causedBy: Invokee = 'system', options?: ManagerStateChangeOption) {
        const {reason, suppressNotification = false} = options || {};
        if(this.queueState.state === RUNNING) {
            this.logger.info(`Activity processing queue is already RUNNING with (${this.queue.length()} queued activities)`);
        } else if (!this.validConfigLoaded) {
            this.logger.warn('Cannot start activity processing queue while manager has an invalid configuration');
        } else {
            this.queue.resume();
            this.logger.info(`Activity processing queue started RUNNING with ${this.queue.length()} queued activities`);
            this.queueState = {
                state: RUNNING,
                causedBy
            }
            if(!suppressNotification) {
                this.notificationManager.handle('runStateChanged', 'Queue Started', reason, causedBy)
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
                while (this.queue.running() > 0) {
                    await sleep(1500);
                    this.logger.verbose(`Activity processing queue is stopping...waiting for ${this.queue.running()} activities to finish processing`);
                }
                this.logger.info(`Activity processing queue stopped by ${causedBy} and ${this.queue.length()} queued activities cleared (waited ${dayjs().diff(pauseWaitStart, 's')} seconds while activity processing finished)`);
                this.queue.kill();
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

            for (const s of this.streams) {
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
            for(const s of this.streams) {
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
            for (const s of this.streams) {
                s.end();
            }
            this.streams = [];
            for (const [k, v] of this.modStreamCallbacks) {
                const stream = ResourceManager.modStreams.get(k) as Poll<Snoowrap.Submission | Snoowrap.Comment>;
                stream.removeListener('item', v);
            }
            this.startedAt = undefined;
            this.eventsCheckedSinceStartTotal = 0;
            this.checksRunSinceStartTotal = 0;
            this.rulesRunSinceStartTotal = 0;
            this.rulesCachedSinceStartTotal = 0;
            this.rulesTriggeredSinceStartTotal = 0;
            this.checksTriggeredSinceStart = new Map();
            this.actionsRunSinceStart = new Map();
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
