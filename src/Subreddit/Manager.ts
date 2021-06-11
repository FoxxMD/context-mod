import Snoowrap, {Comment, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    determineNewResults,
    mergeArr,
} from "../util";
import {CommentStream, SubmissionStream} from "snoostorm";
import pEvent from "p-event";
import {RuleResult} from "../Rule";
import {ConfigBuilder} from "../ConfigBuilder";
import {ManagerOptions, PollingOptions} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import {itemContentPeek} from "../Utils/SnoowrapUtils";
import dayjs from "dayjs";
import LoggedError from "../Utils/LoggedError";
import CacheManager from "./SubredditCache";

export class Manager {
    subreddit: Subreddit;
    client: Snoowrap;
    logger: Logger;
    pollOptions: PollingOptions;
    submissionChecks: SubmissionCheck[];
    commentChecks: CommentCheck[];

    subListedOnce = false;
    streamSub?: SubmissionStream;
    commentsListedOnce = false;
    streamComments?: CommentStream;
    dryRun?: boolean;

    displayLabel: string;
    currentLabels?: string[];

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
        const {polling = {}, caching, dryRun} = configManagerOpts || {};
        this.pollOptions = {...polling, ...opts.polling};
        this.subreddit = sub;
        this.client = client;
        this.dryRun = opts.dryRun || dryRun;

        const cacheConfig = caching === false ? {enabled: false, logger: this.logger} : {
            ...caching,
            enabled: true,
            logger: this.logger
        };
        CacheManager.get(sub.display_name, cacheConfig);

        const commentChecks: Array<CommentCheck> = [];
        const subChecks: Array<SubmissionCheck> = [];
        const structuredChecks = configBuilder.parseToStructured(validJson);
        for (const jCheck of structuredChecks) {
            const checkConfig = {...jCheck, dryRun: this.dryRun || jCheck.dryRun, logger: this.logger, subredditName: sub.display_name};
            if (jCheck.kind === 'comment') {
                commentChecks.push(new CommentCheck(checkConfig));
            } else if (jCheck.kind === 'submission') {
                subChecks.push(new SubmissionCheck(checkConfig));
            }
        }

        for (const subc of subChecks) {
            this.logger.info(`Submission Check: ${subc.name}${subc.description !== undefined ? ` => ${subc.description}` : ''}`);
        }
        this.submissionChecks = subChecks;
        for (const comm of commentChecks) {
            this.logger.info(`Comment Check: ${comm.name}${comm.description !== undefined ? ` => ${comm.description}` : ''}`);
        }
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
        const itemIdentifier = `${checkType} ${itemId}`;
        this.currentLabels = [this.displayLabel, itemIdentifier];
        const [peek, _] = await itemContentPeek(item);
        this.logger.info(`<EVENT> ${peek}`);

        try {
            for (const check of checks) {
                if (checkNames.length > 0 && !checkNames.map(x => x.toLowerCase()).some(x => x === check.name.toLowerCase())) {
                    this.logger.warn(`Check ${check} not in array of requested checks to run, skipping`);
                    continue;
                }
                let triggered = false;
                let currentResults: RuleResult[] = [];
                try {
                    const [checkTriggered, checkResults] = await check.run(item, allRuleResults);
                    currentResults = checkResults;
                    allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, checkResults));
                    triggered = checkTriggered;
                } catch (e) {
                    this.logger.warn(`[Check ${check.name}] Failed with error: ${e.message}`, e);
                }

                if (triggered) {
                    await check.runActions(item, currentResults);
                    break;
                }
            }
        } catch (err) {
            if (!(err instanceof LoggedError)) {
                this.logger.error('An unhandled error occurred while running checks', err);
            }
        } finally {
            this.currentLabels = [this.displayLabel];
            this.logger.debug(`Reddit API Rate Limit remaining: ${this.client.ratelimitRemaining}`);
        }
    }

    async handle(): Promise<void> {
        if (this.submissionChecks.length > 0) {
            const {
                submissions: {
                    limit = 10,
                    interval = 10000,
                } = {}
            } = this.pollOptions
            this.streamSub = new SubmissionStream(this.client, {
                subreddit: this.subreddit.display_name,
                limit,
                pollTime: interval,
            });


            this.streamSub.once('listing', async (listing) => {
                this.subListedOnce = true;
            });
            this.streamSub.on('item', async (item) => {
                if (!this.subListedOnce) {
                    return;
                }
                await this.runChecks('Submission', item)
            });
            this.streamSub.on('listing', (_) => this.logger.debug('Polled Submissions'));
        }

        if (this.commentChecks.length > 0) {
            const {
                comments: {
                    limit = 10,
                    interval = 10000,
                } = {}
            } = this.pollOptions
            this.streamComments = new CommentStream(this.client, {
                subreddit: this.subreddit.display_name,
                limit,
                pollTime: interval,
            });
            this.streamComments.once('listing', () => this.commentsListedOnce = true);
            this.streamComments.on('item', async (item) => {
                if (!this.commentsListedOnce) {
                    return;
                }
                await this.runChecks('Comment', item)
            });
            this.streamComments.on('listing', (_) => this.logger.debug('Polled Comments'));
        }

        if (this.streamSub !== undefined) {
            this.logger.info('Bot Running');
            await pEvent(this.streamSub, 'end');
        } else if (this.streamComments !== undefined) {
            this.logger.info('Bot Running');
            await pEvent(this.streamComments, 'end');
        } else {
            this.logger.warn('No submission or comment checks to run! Bot will not run.');
            return;
        }

        this.logger.info('Bot Stopped');
    }
}
