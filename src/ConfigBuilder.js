"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigBuilder = void 0;
const util_1 = require("./util");
const JsonConfig_guard_1 = require("./JsonConfig.guard");
const CommentCheck_1 = require("./Check/CommentCheck");
const SubmissionCheck_1 = require("./Check/SubmissionCheck");
class ConfigBuilder {
    constructor(options) {
        this.subreddit = options.subreddit;
        if (options.logger !== undefined) {
            this.logger = options.logger;
        }
        else {
            this.logger = util_1.createLabelledLogger(`Config ${this.subreddit.display_name}`, `Config ${this.subreddit.display_name}`);
        }
    }
    buildFromJson(config) {
        const commentChecks = [];
        const subChecks = [];
        if (JsonConfig_guard_1.isJsonConfig(config)) {
            for (const jCheck of config.checks) {
                if (jCheck.kind === 'comment') {
                    commentChecks.push(new CommentCheck_1.CommentCheck(jCheck));
                }
                else if (jCheck.kind === 'submission') {
                    subChecks.push(new SubmissionCheck_1.SubmissionCheck(jCheck));
                }
            }
        }
        else {
            this.logger.error('Json config was not valid. Please use schema to check validity.');
        }
        return [subChecks, commentChecks];
    }
}
exports.ConfigBuilder = ConfigBuilder;
//# sourceMappingURL=ConfigBuilder.js.map