"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepeatSubmissionRule = void 0;
const index_1 = require("./index");
class RepeatSubmissionRule extends index_1.SubmissionRule {
    constructor(options) {
        super(options);
        const { threshold = 5, window = 15, gapAllowance = 2, include = [], exclude = [] } = options;
        this.threshold = threshold;
        this.window = window;
        this.gapAllowance = gapAllowance;
        this.include = include;
        this.exclude = exclude;
    }
    async passes(item) {
        return Promise.resolve([false, []]);
    }
}
exports.RepeatSubmissionRule = RepeatSubmissionRule;
exports.default = RepeatSubmissionRule;
//# sourceMappingURL=RepeatSubmissionRule.js.map