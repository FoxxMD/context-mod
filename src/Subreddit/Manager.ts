import Snoowrap, {Comment, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    determineNewResults,
    mergeArr, parseFromJsonOrYamlToObject, sleep,
} from "../util";
import {CommentStream, SubmissionStream, Poll, ModQueueStream} from "snoostorm";
import pEvent from "p-event";
import {RuleResult} from "../Rule";
import {ConfigBuilder, buildPollingOptions} from "../ConfigBuilder";
import {ManagerOptions, PollingOptionsStrong} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import {itemContentPeek} from "../Utils/SnoowrapUtils";
import LoggedError from "../Utils/LoggedError";
import ResourceManager, {
    SubredditResourceOptions,
    SubredditResources,
    SubredditResourceSetOptions
} from "./SubredditResources";
import {UnmoderatedStream} from "./Streams";
import EventEmitter from "events";
import ConfigParseError from "../Utils/ConfigParseError";
import dayjs, { Dayjs as DayjsObj } from "dayjs";

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
    streams: Poll<Snoowrap.Submission | Snoowrap.Comment>[] = [];
    dryRun?: boolean;
    globalDryRun?: boolean;
    emitter: EventEmitter = new EventEmitter();

    displayLabel: string;
    currentLabels?: string[];

    running: boolean = false;

    getCurrentLabels = () => {
        return this.currentLabels;
    }

    constructor(sub: Subreddit, client: Snoowrap, logger: Logger, sourceData: object, opts: ManagerOptions = {}) {
        const displayLabel = `${sub.display_name_prefixed}`;
        this.displayLabel = displayLabel;
        this.currentLabels = [displayLabel];
        const getLabels = this.getCurrentLabels;
        // dynamic default meta for winston feasible using function getters
        // https://github.com/winstonjs/winston/issues/1626#issuecomment-531142958
        this.logger = logger.child({
            get labels() {
                return getLabels()
            }
        }, mergeArr);
        this.subreddit = sub;
        this.client = client;
        this.parseConfigurationFromObject(sourceData);
    }

    protected parseConfigurationFromObject(configObj: object) {
        const configBuilder = new ConfigBuilder({logger: this.logger});
        const validJson = configBuilder.validateJson(configObj);
        const {checks, ...configManagerOpts} = validJson;
        const {
            polling = [{pollOn: 'unmoderated', limit: 25, interval: 20000}],
            caching,
            dryRun,
            footer,
            nickname
        } = configManagerOpts || {};
        this.pollOptions = buildPollingOptions(polling);
        this.dryRun = this.globalDryRun || dryRun;

        if(nickname !== undefined) {
            this.displayLabel = nickname;
            this.currentLabels = [this.displayLabel];
        }

        if(footer !== undefined) {
            this.resources.footer = footer;
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
                return;
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
            throw new ConfigParseError('Could not parse wiki page contents as JSON or YAML:')
        }

        this.wikiUpdateRunning = false;
        this.parseConfigurationFromObject(configObj);
        this.logger.info('Checks updated');
    }

    async runChecks(checkType: ('Comment' | 'Submission'), item: (Submission | Comment), checkNames: string[] = []): Promise<void> {
        const checks = checkType === 'Comment' ? this.commentChecks : this.submissionChecks;
        const itemId = await item.id;
        let allRuleResults: RuleResult[] = [];
        const itemIdentifier = `${checkType === 'Submission' ? 'SUB' : 'COM'} ${itemId}`;
        this.currentLabels = [this.displayLabel, itemIdentifier];
        const [peek, _] = await itemContentPeek(item);
        this.logger.info(`<EVENT> ${peek}`);

        while(this.wikiUpdateRunning) {
            // sleep for a few seconds while we get new config zzzz
            this.logger.verbose('A wiki config update is running, delaying checks by 3 seconds');
            await sleep(3000);
        }
        if(this.lastWikiCheck.diff(dayjs(), 's') > 60) {
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

        try {
            let triggered = false;
            for (const check of checks) {
                if (checkNames.length > 0 && !checkNames.map(x => x.toLowerCase()).some(x => x === check.name.toLowerCase())) {
                    this.logger.warn(`Check ${check} not in array of requested checks to run, skipping`);
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
                    const runActions = await check.runActions(item, currentResults.filter(x => x.triggered));
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
            this.logger.verbose(`Run Stats:        Checks ${checksRun} | Rules => Total: ${totalRulesRun} Unique: ${allRuleResults.length} Cached: ${totalRulesRun - allRuleResults.length} | Actions ${actionsRun}`);
            this.logger.verbose(`Reddit API Stats: Initial Limit ${startingApiLimit} | Current Limit ${this.client.ratelimitRemaining} | Calls Made ${startingApiLimit - this.client.ratelimitRemaining}`);
            this.currentLabels = [this.displayLabel];
        }
    }

    async handle(): Promise<void> {
        if(this.submissionChecks.length === 0 && this.commentChecks.length === 0) {
            this.logger.warn('No submission or comment checks to run! Bot will not run.');
            return;
        }

        try {

            for(const pollOpt of this.pollOptions) {
                let stream: Poll<Snoowrap.Submission | Snoowrap.Comment>;

                switch(pollOpt.pollOn) {
                    case 'unmoderated':
                        stream = new UnmoderatedStream(this.client, {
                            subreddit: this.subreddit.display_name,
                            limit: pollOpt.limit,
                            pollTime: pollOpt.interval,
                        });
                        break;
                    case 'modqueue':
                        stream = new ModQueueStream(this.client, {
                            subreddit: this.subreddit.display_name,
                            limit: pollOpt.limit,
                            pollTime: pollOpt.interval,
                        });
                        break;
                    case 'newSub':
                        stream = new SubmissionStream(this.client, {
                            subreddit: this.subreddit.display_name,
                            limit: pollOpt.limit,
                            pollTime: pollOpt.interval,
                        });
                        break;
                    case 'newComm':
                        stream = new CommentStream(this.client, {
                            subreddit: this.subreddit.display_name,
                            limit: pollOpt.limit,
                            pollTime: pollOpt.interval,
                        });
                        break;
                }

                stream.once('listing', async (listing) => {
                    // warning if poll event could potentially miss activities
                    if(this.commentChecks.length === 0 && ['unmoderated','modqueue','newComm'].some(x => x === pollOpt.pollOn)) {
                        this.logger.warn(`Polling '${pollOpt.pollOn}' may return Comments but no comments checks were configured.`);
                    }
                    if(this.submissionChecks.length === 0 && ['unmoderated','modqueue','newSub'].some(x => x === pollOpt.pollOn)) {
                        this.logger.warn(`Polling '${pollOpt.pollOn}' may return Submissions but no submission checks were configured.`);
                    }
                    this.streamListedOnce.push(pollOpt.pollOn);
                });
                stream.on('item', async (item) => {
                    if (!this.streamListedOnce.includes(pollOpt.pollOn)) {
                        return;
                    }
                    if(item instanceof Submission) {
                        if(this.submissionChecks.length > 0) {
                            await this.runChecks('Submission', item);
                        }
                    } else if(this.commentChecks.length > 0) {
                        await this.runChecks('Comment', item)
                    }
                });
                this.streams.push(stream);
            }

            this.running = true;
            this.logger.info('Bot Running');

            await pEvent(this.emitter, 'end');
        } catch (err) {
            this.logger.error('Encountered unhandled error, manager is bailing out');
            this.logger.error(err);
        } finally {
            this.stop();
        }
    }

    stop() {
        if(this.running) {
            for(const s of this.streams) {
                s.end();
            }
            this.emitter.emit('end');
            this.running = false;
            this.logger.info('Bot Stopped');
        }
    }
}
