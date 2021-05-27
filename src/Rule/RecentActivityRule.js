"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecentActivityRule = void 0;
const index_1 = require("./index");
class RecentActivityRule extends index_1.Rule {
    constructor(options) {
        super(options);
        this.window = options.window;
        this.thresholds = options.thresholds;
    }
    async passes(item) {
        return Promise.resolve([false, []]);
    }
}
exports.RecentActivityRule = RecentActivityRule;
exports.default = RecentActivityRule;
//# sourceMappingURL=RecentActivityRule.js.map