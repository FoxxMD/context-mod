import Snoowrap, {Comment, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    determineNewResults,
    mergeArr,
} from "../util";
import {CommentStream, SubmissionStream, Poll, ModQueueStream} from "snoostorm";
import pEvent from "p-event";
import {RuleResult} from "../Rule";
import {ConfigBuilder, buildPollingOptions} from "../ConfigBuilder";
import {ManagerOptions, PollingOptionsStrong} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import {itemContentPeek} from "../Utils/SnoowrapUtils";
import LoggedError from "../Utils/LoggedError";
import ResourceManager, {SubredditResourceOptions, SubredditResources} from "./SubredditResources";
import {UnmoderatedStream} from "./Streams";
import EventEmitter from "events";

export class Manager {
    subreddit: Subreddit;
    client: Snoowrap;
    logger: Logger;
    pollOptions: PollingOptionsStrong[];
    submissionChecks: SubmissionCheck[];
    commentChecks: CommentCheck[];
    resources: SubredditResources;

    streamListedOnce: string[] = [];
    streams: Poll<Snoowrap.Submission | Snoowrap.Comment>[] = [];
    dryRun?: boolean;

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

        const configBuilder = new ConfigBuilder({logger: this.logger});
        const validJson = configBuilder.validateJson(sourceData);
        const {checks, ...configManagerOpts} = validJson;
        const {polling = [{pollOn: 'unmoderated', limit: 25, interval: 20000}], caching, dryRun, footer, nickname} = configManagerOpts || {};
        this.pollOptions = buildPollingOptions(polling);
        this.subreddit = sub;
        this.client = client;
        this.dryRun = opts.dryRun || dryRun;

        if(nickname !== undefined) {
            this.displayLabel = nickname;
            this.currentLabels = [this.displayLabel];
        }

        let resourceConfig: SubredditResourceOptions = {
            logger: this.logger,
            subreddit: sub,
            footer,
            enabled: true
        };

        if(caching === false) {
            resourceConfig.enabled = false;
        } else {
            resourceConfig = {...resourceConfig, ...caching};
        }

        this.resources = ResourceManager.set(sub.display_name, resourceConfig);

        const commentChecks: Array<CommentCheck> = [];
        const subChecks: Array<SubmissionCheck> = [];
        const structuredChecks = configBuilder.parseToStructured(validJson);
        for (const jCheck of structuredChecks) {
            const checkConfig = {
                ...jCheck,
                dryRun: this.dryRun || jCheck.dryRun,
                logger: this.logger,
                subredditName: sub.display_name
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

    async runChecks(checkType: ('Comment' | 'Submission'), item: (Submission | Comment), checkNames: string[] = []): Promise<void> {
        const checks = checkType === 'Comment' ? this.commentChecks : this.submissionChecks;
        const itemId = await item.id;
        let allRuleResults: RuleResult[] = [];
        const itemIdentifier = `${checkType === 'Submission' ? 'SUB' : 'COM'} ${itemId}`;
        this.currentLabels = [this.displayLabel, itemIdentifier];
        const [peek, _] = await itemContentPeek(item);
        this.logger.info(`<EVENT> ${peek}`);
        const startingApiLimit = this.client.ratelimitRemaining;

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
                    this.logger.warn(`Check ${check.name} Failed with error: ${e.message}`, e);
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
            if (!(err instanceof LoggedError)) {
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

            const emitter = new EventEmitter();
            await pEvent(emitter, 'end');
        } catch (err) {
            this.logger.error('Encountered unhandled error, manager is bailing out');
            this.logger.error(err);
        } finally {
            this.running = false;
            this.logger.info('Bot Stopped');
        }
    }
}
