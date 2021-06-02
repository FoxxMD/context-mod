import Snoowrap, {Comment, Submission, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {createLabelledLogger, sleep} from "../util";
import {CommentStream, SubmissionStream} from "snoostorm";
import pEvent from "p-event";

export interface ManagerOptions {
    submissions?: {
        limit?: number,
        interval?: number,
    },
    comments?: {
        limit?: number,
        interval?: number,
    }
}

export class Manager {
    subreddit: Subreddit;
    client: Snoowrap;
    logger: Logger;
    pollOptions: ManagerOptions;
    submissionChecks: SubmissionCheck[];
    commentChecks: CommentCheck[];

    subListedOnce = false;
    streamSub?: SubmissionStream;
    commentsListedOnce = false;
    streamComments?: CommentStream;

    constructor(sub: Subreddit, client: Snoowrap, subChecks: SubmissionCheck[], commentChecks: CommentCheck[], opts: ManagerOptions = {}) {
        this.logger = createLabelledLogger(`Manager ${sub.display_name}`, `Manager ${sub.display_name}`);
        this.pollOptions = opts;
        this.subreddit = sub;
        this.client = client;
        this.submissionChecks = subChecks;
        this.commentChecks = commentChecks;
        this.logger.info(`Found Checks -- Submission: ${this.submissionChecks.length} | Comment: ${this.commentChecks.length}`);
    }

    async runChecks(checkType: ('Comment' | 'Submission'), item: (Submission | Comment)): Promise<void> {
        const checks = checkType === 'Comment' ? this.commentChecks : this.submissionChecks;
        const itemId = await item.id;
        for (const check of checks) {
            this.logger.debug(`Running Check ${check.name} on ${checkType} (ID ${itemId})`);
            let triggered = false;
            try {
                const [checkTriggered, rules] = await check.run(item);
                triggered = checkTriggered;
                const invokedRules = rules.map(x => x.name).join(' | ');
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
                await check.runActions(item, this.client);
                this.logger.debug(`Ran actions for Check ${check.name}`);
                break;
            }
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


            this.streamSub.once('listing', async(listing) => {
                this.subListedOnce = true;
                // for debugging
                await this.runChecks('Submission', listing[0]);
            });
            this.streamSub.on('item', async (item) => {
                if(!this.subListedOnce) {
                    return;
                }
                await this.runChecks('Submission', item)
            });
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
                if(!this.commentsListedOnce) {
                    return;
                }
                await this.runChecks('Comment', item)
            });
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
