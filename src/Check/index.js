"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Check = void 0;
const RuleSet_1 = require("../Rule/RuleSet");
const Rule_1 = require("../Rule");
const Action_1 = __importStar(require("../Action"));
const RuleSet_guard_1 = require("../Rule/RuleSet.guard");
const index_guard_1 = require("../Rule/index.guard");
const index_guard_2 = require("../Action/index.guard");
class Check {
    //logger: Logger;
    constructor(options) {
        this.actions = [];
        this.rules = [];
        const { name, description, ruleJoin = 'AND', rules, actions, } = options;
        this.name = name;
        this.description = description;
        this.ruleJoin = ruleJoin;
        for (const r of rules) {
            if (r instanceof Rule_1.Rule || r instanceof RuleSet_1.RuleSet) {
                this.rules.push(r);
            }
            else if (RuleSet_guard_1.isRuleSetConfig(r)) {
                this.rules.push(new RuleSet_1.RuleSet(r));
            }
            else if (index_guard_1.isRuleConfig(r)) {
                this.rules.push(Rule_1.ruleFactory(r));
            }
        }
        for (const a of actions) {
            if (a instanceof Action_1.default) {
                this.actions.push(a);
            }
            else if (index_guard_2.isActionConfig(a)) {
                this.actions.push(Action_1.actionFactory(a));
            }
        }
    }
    async passes(item) {
        let allRules = [];
        for (const r of this.rules) {
            const [passed, rules] = await r.passes(item);
            if (passed) {
                if (this.ruleJoin === 'OR') {
                    return [true, rules];
                }
                else {
                    allRules = allRules.concat(rules);
                }
            }
            else if (this.ruleJoin === 'AND') {
                return [false, rules];
            }
        }
        return [true, allRules];
    }
    async runActions(item, client) {
        for (const a of this.actions) {
            await a.handle(item, client);
        }
    }
}
exports.Check = Check;
//# sourceMappingURL=index.js.map