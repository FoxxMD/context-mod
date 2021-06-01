import {IRule, Passable, Rule, RuleJSONConfig} from "./index";
import {isRuleConfig} from "./index.guard";
import {Comment, Submission} from "snoowrap";
import {ruleFactory} from "./RuleFactory";
import {RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import {RepeatSubmissionJSONConfig} from "./SubmissionRule/RepeatSubmissionRule";

export class RuleSet implements IRuleSet, Passable {
    rules: Rule[] = [];
    condition: 'OR' | 'AND';

    constructor(options: RuleSetOptions) {
        this.condition = options.condition;
        for (const r of options.rules) {
            if (r instanceof Rule) {
                this.rules.push(r);
            } else if (isRuleConfig(r)) {
                this.rules.push(ruleFactory(r));
            }
        }
    }

    async passes(item: Comment|Submission): Promise<[boolean, Rule[]]> {
        for(const r of this.rules) {
            const [passed, _] = await r.passes(item);
            if(passed) {
                if(this.condition === 'OR') {
                    return [true, [r]];
                }
            } else if(this.condition === 'AND') {
                return [false, [r]];
            }
        }
        return [true, this.rules];
    }
}

export interface IRuleSet {
    condition: 'OR' | 'AND',
    rules: IRule[];
}

export interface RuleSetOptions extends IRuleSet {
    rules: Array<IRule | RuleJSONConfig>
}

/** @see {isRuleSetConfig} ts-auto-guard:type-guard */
export interface RuleSetJSONConfig extends IRuleSet {
    rules: Array<RecentActivityRuleJSONConfig | RepeatSubmissionJSONConfig>
}
