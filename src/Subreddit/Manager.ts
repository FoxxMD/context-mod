import Snoowrap, {Comment, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {
    determineNewResults,
    loggerMetaShuffle,
    mergeArr,
} from "../util";
import {CommentStream, SubmissionStream} from "snoostorm";
import pEvent from "p-event";
import {RuleResult} from "../Rule";
import {ConfigBuilder} from "../ConfigBuilder";
import {PollingOptions} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import {itemContentPeek} from "../Utils/SnoowrapUtils";
import dayjs from "dayjs";

export interface ManagerOptions {
    polling?: PollingOptions
    /**
     * If present, time in milliseconds between HEARTBEAT log statements with current api limit count. Nice to have to know things are still ticking if there is low activity
     * */
    heartbeatInterval?: number
    /**
     * When Reddit API limit remaining reaches this number context bot will start warning on every poll interval
     * @default 250
     * */
    apiLimitWarning?: number
}

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
    heartbeatInterval?: number;
    lastHeartbeat = dayjs();
    apiLimitWarning: number;

    constructor(sub: Subreddit, client: Snoowrap, logger: Logger, sourceData: object, opts: ManagerOptions = {}) {
        this.logger = logger.child(loggerMetaShuffle(logger, undefined, [`r/${sub.display_name}`], {truncateLength: 40}), mergeArr);

        const configBuilder = new ConfigBuilder({logger: this.logger});
        const [subChecks, commentChecks, configManagerOptions] = configBuilder.buildFromJson(sourceData);
        const {polling = {}, heartbeatInterval, apiLimitWarning = 250} = configManagerOptions || {};
        this.pollOptions = {...polling, ...opts.polling};
        this.heartbeatInterval = heartbeatInterval;
        this.apiLimitWarning = apiLimitWarning;
        this.subreddit = sub;
        this.client = client;
        for(const sub of subChecks) {
            this.logger.debug(`Submission Check: ${sub.name}${sub.description !== undefined ? ` ${sub.description}` : ''}`);
        }
        this.submissionChecks = subChecks;
        for(const comm of commentChecks) {
            this.logger.debug(`Comment Check: ${comm.name}${comm.description !== undefined ? ` ${comm.description}` : ''}`);
        }
        this.commentChecks = commentChecks;
        const checkSummary = `Found Checks -- Submission: ${this.submissionChecks.length} | Comment: ${this.commentChecks.length}`;
        if (subChecks.length === 0 && commentChecks.length === 0) {
            this.logger.warn(checkSummary);
        } else {
            this.logger.info(checkSummary);
        }
    }

    async runChecks(checkType: ('Comment' | 'Submission'), item: (Submission | Comment)): Promise<void> {
        const checks = checkType === 'Comment' ? this.commentChecks : this.submissionChecks;
        const itemId = await item.id;
        let allRuleResults: RuleResult[] = [];
        const itemIdentifier = `${checkType} ${itemId}`;
        const [peek, _] = await itemContentPeek(item);
        this.logger.debug(`New Event: ${itemIdentifier} => ${peek}`);

        for (const check of checks) {
            this.logger.debug(`Running Check ${check.name} on ${itemIdentifier}`);
            let triggered = false;
            let currentResults: RuleResult[] = [];
            try {
                const [checkTriggered, checkResults] = await check.run(item, allRuleResults);
                currentResults = checkResults;
                allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, checkResults));
                triggered = checkTriggered;
                const invokedRules = checkResults.map(x => x.name || x.premise.kind).join(' | ');
                if (checkTriggered) {
                    this.logger.debug(`Check ${check.name} was triggered with invoked Rules: ${invokedRules}`);
                } else {
                    this.logger.debug(`Check ${check.name} was not triggered using invoked Rule(s): ${invokedRules}`);
                }

            } catch (e) {
                this.logger.warn(`Check ${check.name} on Submission (ID ${itemId}) failed with error: ${e.message}`, e);
            }

            if (triggered) {
                // TODO give actions a name
                await check.runActions(item, currentResults);
                this.logger.debug(`Ran actions for Check ${check.name}`);
                break;
            }
        }
    }

    heartbeat() {
        const apiRemaining = this.client.ratelimitRemaining;
        if(this.heartbeatInterval !== undefined && dayjs().diff(this.lastHeartbeat) >= this.heartbeatInterval) {
            this.logger.info(`HEARTBEAT -- Reddit API Rate Limit remaining: ${apiRemaining}`);
            this.lastHeartbeat = dayjs();
        }
        if(apiRemaining < this.apiLimitWarning) {
            this.logger.warn(`Reddit API rate limit remaining: ${apiRemaining} (Warning at ${this.apiLimitWarning})`);
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
                // for debugging
                // await this.runChecks('Submission', listing[0]);
            });
            this.streamSub.on('item', async (item) => {
                if (!this.subListedOnce) {
                    return;
                }
                await this.runChecks('Submission', item)
            });
            this.streamSub.on('listing', (_) => this.heartbeat());
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
            this.streamComments.on('listing', (_) => this.heartbeat());
        }

        if (this.streamSub !== undefined) {
            await pEvent(this.streamSub, 'end');
        } else if (this.streamComments !== undefined) {
            await pEvent(this.streamComments, 'end');
        } else {
            this.logger.warn('No submission or comment checks to run!');
        }
    }
}
