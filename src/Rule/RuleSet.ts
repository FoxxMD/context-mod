import {IRule, Triggerable, Rule, RuleJSONConfig, RuleResult} from "./index";
import {isRuleConfig} from "./index.guard";
import {Comment, Submission} from "snoowrap";
import {ruleFactory} from "./RuleFactory";
import {RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import {RepeatSubmissionJSONConfig} from "./SubmissionRule/RepeatSubmissionRule";
import {determineNewResults, findResultByPremise} from "../util";

export class RuleSet implements IRuleSet, Triggerable {
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

    async run(item: Comment | Submission, existingResults: RuleResult[] = []): Promise<[boolean, RuleResult[]]> {
        let results: RuleResult[] = [];
        let runOne = false;
        for (const r of this.rules) {
            const combinedResults = [...existingResults, ...results];
            const [passed, [result]] = await r.run(item, combinedResults);
            //results = results.concat(determineNewResults(combinedResults, result));
             results.push(result);
            // skip rule if author check failed
            if (passed === null) {
                continue;
            }
            runOne = true;
            if (passed) {
                if (this.condition === 'OR') {
                    return [true, results];
                }
            } else if (this.condition === 'AND') {
                return [false, results];
            }
        }
        // if no rules were run it's the same as if nothing was triggered
        if (!runOne) {
            return [false, results];
        }
        return [true, results];
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
