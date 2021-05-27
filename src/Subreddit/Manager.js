"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Manager = void 0;
const util_1 = require("../util");
const snoostorm_1 = require("snoostorm");
const p_event_1 = __importDefault(require("p-event"));
class Manager {
    constructor(sub, client, subChecks, commentChecks) {
        this.logger = util_1.createLabelledLogger(`Manager ${sub.display_name}`, `Manager ${sub.display_name}`);
        this.subreddit = sub;
        this.client = client;
        this.submissionChecks = subChecks;
        this.commentChecks = commentChecks;
        this.logger.info(`Found Checks -- Submission: ${this.submissionChecks.length} | Comment: ${this.commentChecks.length}`);
    }
    async handle() {
        let subStream;
        let cStream;
        if (this.submissionChecks.length > 0) {
            subStream = new snoostorm_1.SubmissionStream(this.client, {
                subreddit: this.subreddit.display_name,
                limit: 10,
                pollTime: 5000,
            });
            subStream.on('item', async (item) => {
                for (const check of this.submissionChecks) {
                    this.logger.debug(`Running Check ${check.name} on Submission (ID ${item.id})`);
                    const [passed, rules] = await check.passes(item);
                    const invokedRules = rules.map(x => x.name).join(' | ');
                    if (passed) {
                        this.logger.debug(`Check ${check.name} passed with invoked Rules: ${invokedRules}`);
                    }
                    else {
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
        if (this.commentChecks.length > 0) {
            cStream = new snoostorm_1.CommentStream(this.client, {
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
                    }
                    else {
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
            await p_event_1.default(subStream, 'end');
        }
        else if (cStream !== undefined) {
            await p_event_1.default(cStream, 'end');
        }
        else {
            this.logger.warn('No submission or comment checks to run!');
        }
    }
}
exports.Manager = Manager;
//# sourceMappingURL=Manager.js.map