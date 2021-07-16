import Snoowrap, {Comment, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    createRetryHandler,
    determineNewResults,
    mergeArr, parseFromJsonOrYamlToObject, pollingInfo, sleep, totalFromMapStats,
} from "../util";
import {Poll} from "snoostorm";
import pEvent from "p-event";
import {RuleResult} from "../Rule";
import {ConfigBuilder, buildPollingOptions} from "../ConfigBuilder";
import {
    DEFAULT_POLLING_INTERVAL,
    DEFAULT_POLLING_LIMIT,
    ManagerOptions,
    PollingOptionsStrong
} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import {activityIsRemoved, itemContentPeek} from "../Utils/SnoowrapUtils";
import LoggedError from "../Utils/LoggedError";
import ResourceManager, {
    SubredditResourceOptions,
    SubredditResources,
    SubredditResourceSetOptions
} from "./SubredditResources";
import {SPoll, UnmoderatedStream, ModQueueStream, SubmissionStream, CommentStream} from "./Streams";
import EventEmitter from "events";
import ConfigParseError from "../Utils/ConfigParseError";
import dayjs, { Dayjs as DayjsObj } from "dayjs";
import Action from "../Action";

export interface runCheckOptions {
    checkNames?: string[],
    delayUntil?: number,
    dryRun?: boolean,
}

export class Manager {
    subreddit: Subreddit;
    client: Snoowrap;
    logger: Logger;
    pollOptions!: PollingOptionsStrong[];
    submissionChecks!: SubmissionCheck[];
    commentChecks!: CommentCheck[];
    resources!: SubredditResources;
    wikiLocation: string = 'botconfig/contextbot';
    lastWikiRevision?: DayjsObj
    lastWikiCheck: DayjsObj = dayjs();
    wikiUpdateRunning: boolean = false;

    streamListedOnce: string[] = [];
    streams: SPoll<Snoowrap.Submission | Snoowrap.Comment>[] = [];
    modStreamCallbacks: Map<string, any> = new Map();
    dryRun?: boolean;
    globalDryRun?: boolean;
    emitter: EventEmitter = new EventEmitter();

    displayLabel: string;
    currentLabels: string[] = [];

    startedAt?: DayjsObj;
    running: boolean = false;

    eventsCheckedTotal: number = 0;
    eventsCheckedSinceStartTotal: number = 0;
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
    actionsRun: Map<string, number> = new Map();
    actionsRunSinceStart: Map<string, number> = new Map();

    getStats = () => {
        return {
            eventsCheckedTotal: this.eventsCheckedTotal,
            eventsCheckedSinceStartTotal: this.eventsCheckedSinceStartTotal,
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
            actionsRun: this.actionsRun,
            actionsRunTotal: totalFromMapStats(this.actionsRun),
            actionsRunSinceStart: this.actionsRunSinceStart,
            actionsRunSinceStartTotal: totalFromMapStats(this.actionsRunSinceStart)
        }
    }

    getCurrentLabels = () => {
        return this.currentLabels;
    }

    getDisplay = () => {
        return this.displayLabel;
    }

    constructor(sub: Subreddit, client: Snoowrap, logger: Logger, sourceData: object, opts: ManagerOptions = {}) {
        const {dryRun} = opts;
        this.displayLabel =  opts.nickname || `${sub.display_name_prefixed}`;
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
        this.subreddit = sub;
        this.client = client;
        this.parseConfigurationFromObject(sourceData);
    }

    protected parseConfigurationFromObject(configObj: object) {
        const configBuilder = new ConfigBuilder({logger: this.logger});
        const validJson = configBuilder.validateJson(configObj);
        const {checks, ...configManagerOpts} = validJson;
        const {
            polling = [{pollOn: 'unmoderated', limit: DEFAULT_POLLING_LIMIT, interval: DEFAULT_POLLING_INTERVAL}],
            caching,
            dryRun,
            footer,
            nickname
        } = configManagerOpts || {};
        this.pollOptions = buildPollingOptions(polling);
        this.dryRun = this.globalDryRun || dryRun;

        this.displayLabel = nickname || `${this.subreddit.display_name_prefixed}`;

        if(footer !== undefined) {
            this.resources.footer = footer;
        }

        this.logger.info(`Dry Run: ${this.dryRun === true}`);
        for(const p of this.pollOptions) {
            this.logger.info(`Polling Info => ${pollingInfo(p)}`)
        }

        let resourceConfig: SubredditResourceSetOptions = {
            footer,
            enabled: true
        };
        if(caching === false) {
            resourceConfig.enabled = false;
        } else {
            resourceConfig = {...resourceConfig, ...caching};
        }
        if(this.resources === undefined) {
            this.resources = ResourceManager.set(this.subreddit.display_name, {
                ...resourceConfig,
                logger: this.logger,
                subreddit: this.subreddit
            });
        }
        this.resources.setOptions(resourceConfig);

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
    }

    async parseConfiguration(force: boolean = false) {
        this.wikiUpdateRunning = true;
        this.lastWikiCheck = dayjs();

        let sourceData: string;
        try {
            // @ts-ignore
            const wiki = await this.subreddit.getWikiPage(this.wikiLocation).fetch();
            const revisionDate = dayjs.unix(wiki.revision_date);
            if (!force && (this.lastWikiRevision !== undefined && this.lastWikiRevision.isSame(revisionDate))) {
                // nothing to do, we already have this revision
                this.wikiUpdateRunning = false;
                this.logger.verbose('Config is up to date');
                return false;
            }
            if (this.lastWikiRevision !== undefined) {
                this.logger.info(`Updating config due to stale wiki page (${dayjs.duration(dayjs().diff(revisionDate)).humanize()} old)`)
            }
            this.lastWikiRevision = revisionDate;
            sourceData = await wiki.content_md;
        } catch (err) {
            const msg = `Could not read wiki configuration. Please ensure the page https://reddit.com${this.subreddit.url}wiki/${this.wikiLocation} exists and is readable -- error: ${err.message}`;
            this.logger.error(msg);
            this.wikiUpdateRunning = false;
            throw new ConfigParseError(msg);
        }

        if (sourceData === '') {
            this.logger.error(`Wiki page contents was empty`);
            this.wikiUpdateRunning = false;
            throw new ConfigParseError('Wiki page contents was empty');
        }

        const [configObj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(sourceData);

        if (configObj === undefined) {
            this.logger.error(`Could not parse wiki page contents as JSON or YAML:`);
            this.logger.error(jsonErr);
            this.logger.error(yamlErr);
            this.wikiUpdateRunning = false;
            throw new ConfigParseError('Could not parse wiki page contents as JSON or YAML')
        }

        this.wikiUpdateRunning = false;
        this.parseConfigurationFromObject(configObj);
        this.logger.info('Checks updated');
        return true;
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
        const [peek, _] = await itemContentPeek(item);
        this.logger.info(`<EVENT> ${peek}`);

        const {
            checkNames = [],
            delayUntil,
            dryRun,
        } = options || {};

        if(delayUntil !== undefined) {
            const created = dayjs.unix(item.created_utc);
            const diff = dayjs().diff(created, 's');
            if(diff < delayUntil) {
                this.logger.verbose(`Delaying processing until Activity is ${delayUntil} seconds old (${delayUntil - diff}s)`);
                await sleep(delayUntil - diff);
                // @ts-ignore
                item = await activity.refresh();
            }
        }

        while(this.wikiUpdateRunning) {
            // sleep for a few seconds while we get new config zzzz
            this.logger.verbose('A wiki config update is running, delaying checks by 3 seconds');
            await sleep(3000);
        }
        if(dayjs().diff(this.lastWikiCheck, 's') > 60) {
            // last checked more than 60 seconds ago for config, try and update
            await this.parseConfiguration();
        }

        const startingApiLimit = this.client.ratelimitRemaining;

        if(item instanceof Submission) {
            if(await item.removed_by_category === 'deleted') {
                this.logger.warn('Submission was deleted, cannot process.');
                return;
            }
        } else if(item.author.name === '[deleted]') {
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
                    this.logger.warn(`Check ${check.name} not in array of requested checks to run, skipping`);
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
                    if(e.logged !== true) {
                        this.logger.warn(`Running rules for Check ${check.name} failed due to uncaught exception`, e);
                    }
                }

                if (triggered) {
                    this.checksTriggered.set(check.name, (this.checksTriggered.get(check.name) || 0) + 1);
                    this.checksTriggeredSinceStart.set(check.name, (this.checksTriggeredSinceStart.get(check.name) || 0) + 1);
                    runActions = await check.runActions(item, currentResults.filter(x => x.triggered), dryRun);
                    actionsRun = runActions.length;
                    break;
                }
            }

            if(!triggered) {
                this.logger.info('No checks triggered');
            }

        } catch (err) {
            if (!(err instanceof LoggedError) && err.logged !== true) {
                this.logger.error('An unhandled error occurred while running checks', err);
            }
        } finally {
            const cachedTotal = totalRulesRun - allRuleResults.length;
            const triggeredRulesTotal = allRuleResults.filter(x => x.triggered).length;

            this.checksRunTotal+= checksRun;
            this.checksRunSinceStartTotal+= checksRun;
            this.rulesRunTotal+= totalRulesRun;
            this.rulesRunSinceStartTotal+= totalRulesRun;
            this.rulesCachedTotal+= cachedTotal;
            this.rulesCachedSinceStartTotal+= cachedTotal;
            this.rulesTriggeredTotal+= triggeredRulesTotal;
            this.rulesTriggeredSinceStartTotal+= triggeredRulesTotal;

            for(const a of runActions) {
                const name = a.getActionUniqueName();
                this.actionsRun.set(name, (this.actionsRun.get(name) || 0) + 1);
                this.actionsRunSinceStart.set(name, (this.actionsRunSinceStart.get(name) || 0) + 1)
            }

            this.logger.verbose(`Run Stats:        Checks ${checksRun} | Rules => Total: ${totalRulesRun} Unique: ${allRuleResults.length} Cached: ${totalRulesRun - allRuleResults.length} | Actions ${actionsRun}`);
            this.logger.verbose(`Reddit API Stats: Initial Limit ${startingApiLimit} | Current Limit ${this.client.ratelimitRemaining} | Est. Calls Made ${startingApiLimit - this.client.ratelimitRemaining}`);
            this.currentLabels = [];
        }
    }

    async buildPolling() {
        this.stop();

        // give current handle() time to stop
        await sleep(1000);

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
                        if (limit === DEFAULT_POLLING_LIMIT && interval === DEFAULT_POLLING_INTERVAL) {
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
                    if(!this.streamListedOnce.includes(pollOn)) {
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

                const onItem = async (item: Comment|Submission) => {
                    if (!this.streamListedOnce.includes(pollOn)) {
                        return;
                    }
                    if(item.subreddit.display_name !== subName) {
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
                        try {
                            await this.runChecks(checkType, item, {delayUntil});
                        } catch (err) {
                            this.logger.error('Encountered unhandled error, event processing stopped early');
                            this.logger.error(err);
                        }
                    }
                };

                stream.on('item', onItem);

                if(modStreamType !== undefined) {
                    this.modStreamCallbacks.set(pollOn, onItem);
                } else {
                    // @ts-ignore
                    stream.on('error', async (err: any) => {

                        this.logger.error('Polling error occurred', err);
                        const shouldRetry = await retryHandler(err);
                        if (shouldRetry) {
                            stream.startInterval();
                        } else {
                            throw err;
                        }
                    });
                    this.streams.push(stream);
                }
            }
    }

    async handle(): Promise<void> {
        if(this.submissionChecks.length === 0 && this.commentChecks.length === 0) {
            this.logger.warn('No submission or comment checks to run! Bot will not run.');
            return;
        }

        try {
            for(const s of this.streams) {
                s.startInterval();
            }
            this.startedAt = dayjs();
            this.running = true;
            this.logger.info('Bot Running');

            await pEvent(this.emitter, 'end');
        } catch (err) {
            this.logger.error('Too many request errors occurred or an unhandled error was encountered, manager is stopping');
        } finally {
            this.stop();
        }
    }

    stop() {
        if(this.running) {
            for(const s of this.streams) {
                s.end();
            }
            this.streams = [];
            for(const [k,v] of this.modStreamCallbacks) {
                const stream = ResourceManager.modStreams.get(k) as Poll<Snoowrap.Submission | Snoowrap.Comment>;
                stream.removeListener('item', v);
            }
            this.emitter.emit('end');
            this.startedAt = undefined;
            this.eventsCheckedSinceStartTotal = 0;
            this.checksRunSinceStartTotal = 0;
            this.rulesRunSinceStartTotal = 0;
            this.rulesCachedSinceStartTotal = 0;
            this.rulesTriggeredSinceStartTotal = 0;
            this.checksTriggeredSinceStart = new Map();
            this.actionsRunSinceStart = new Map();
            this.running = false;
            this.logger.info('Bot Stopped');
        }
    }
}
