import Snoowrap, {Comment, Submission, Subreddit} from "snoowrap";
import {Logger} from "winston";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {createLabelledLogger} from "../util";
import {CommentStream, SubmissionStream} from "snoostorm";
import pEvent from "p-event";

export class Manager {
    subreddit: Subreddit;
    client: Snoowrap;
    logger: Logger;
    submissionChecks: SubmissionCheck[];
    commentChecks: CommentCheck[];

    constructor(sub: Subreddit, client: Snoowrap, subChecks: SubmissionCheck[], commentChecks: CommentCheck[]) {
        this.logger = createLabelledLogger(`Manager ${sub.display_name}`, `Manager ${sub.display_name}`);
        this.subreddit = sub;
        this.client = client;
        this.submissionChecks = subChecks;
        this.commentChecks = commentChecks;
        this.logger.info(`Found Checks -- Submission: ${this.submissionChecks.length} | Comment: ${this.commentChecks.length}`);
    }

    async runChecks(checkType: ('Comment'|'Submission'), item: (Submission|Comment)): Promise<void> {
        const checks = checkType === 'Comment' ? this.commentChecks : this.submissionChecks;
        const itemId = await item.id;
        for(const check of checks) {
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
        let subStream;
        let cStream;
        if (this.submissionChecks.length > 0) {
            subStream = new SubmissionStream(this.client, {
                subreddit: this.subreddit.display_name,
                limit: 10,
                pollTime: 5000,
            });

            // this.client.getSubmission('np85nc')
            subStream.on('item', async (item) => await this.runChecks('Submission', item));
        }

        if (this.commentChecks.length > 0) {
            cStream = new CommentStream(this.client, {
                subreddit: this.subreddit.display_name,
                limit: 10,
                pollTime: 5000,
            });

            cStream.on('item', async (item) => await this.runChecks('Comment', item));
        }

        if (subStream !== undefined) {
            await pEvent(subStream, 'end');
        } else if (cStream !== undefined) {
            await pEvent(cStream, 'end');
        } else {
            this.logger.warn('No submission or comment checks to run!');
        }
    }
}
