import Snoowrap, {Subreddit} from "snoowrap";
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

    async handle(): Promise<void> {
        let subStream;
        let cStream;
        if (this.submissionChecks.length > 0) {
            subStream = new SubmissionStream(this.client, {
                subreddit: this.subreddit.display_name,
                limit: 10,
                pollTime: 5000,
            });

            subStream.on('item', async (item) => {
                for (const check of this.submissionChecks) {
                    this.logger.debug(`Running Check ${check.name} on Submission (ID ${item.id})`);
                    const newItem = this.client.getSubmission('npac0x');
                    let passed = false;
                    try {
                        const [passed, rules] = await check.passes(newItem);
                        const invokedRules = rules.map(x => x.name).join(' | ');
                        if (passed) {
                            this.logger.debug(`Check ${check.name} passed with invoked Rules: ${invokedRules}`);
                        } else {
                            this.logger.debug(`Check ${check.name} failed on invoked Rule(s): ${invokedRules}`);
                        }

                    } catch (e) {
                        this.logger.warn(`Check ${check.name} on Submission (ID ${item.id}) failed with error: ${e.message}`, e);
                    }

                    if (passed) {
                        // TODO give actions a name
                        await check.runActions(item, this.client);
                        this.logger.debug(`Ran actions for Check ${check.name}`);
                        break;
                    }
                }
            });
        }

        if (this.commentChecks.length > 0) {
            cStream = new CommentStream(this.client, {
                subreddit: this.subreddit.display_name,
                limit: 10,
                pollTime: 5000,
            });

            cStream.on('item', async (item) => {
                for (const check of this.commentChecks) {
                    this.logger.debug(`Running Check ${check.name} on Comment (ID ${item.id})`);
                    const [passed, rules] = await check.passes(item);
                    const invokedRules = rules.map(x => x.name).join(' | ');
                    if (passed) {
                        this.logger.debug(`Check ${check.name} passed with invoked Rules: ${invokedRules}`);
                    } else {
                        this.logger.debug(`Check ${check.name} failed on invoked Rule(s): ${invokedRules}`);
                    }

                    if (passed) {
                        // TODO give actions a name
                        await check.runActions(item, this.client);
                        this.logger.debug(`Ran actions for Check ${check.name}`);
                        break;
                    }
                }
            });
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
