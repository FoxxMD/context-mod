"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuleSet = void 0;
const index_1 = require("./index");
const index_guard_1 = require("./index.guard");
class RuleSet {
    constructor(options) {
        this.rules = [];
        this.condition = options.condition;
        for (const r of options.rules) {
            if (r instanceof index_1.Rule) {
                this.rules.push(r);
            }
            else if (index_guard_1.isRuleConfig(r)) {
                this.rules.push(index_1.ruleFactory(r));
            }
        }
    }
    async passes(item) {
        for (const r of this.rules) {
            const [passed, _] = await r.passes(item);
            if (passed) {
                if (this.condition === 'OR') {
                    return [true, [r]];
                }
            }
            else if (this.condition === 'AND') {
                return [false, [r]];
            }
        }
        return [true, this.rules];
    }
}
exports.RuleSet = RuleSet;
//# sourceMappingURL=RuleSet.js.map