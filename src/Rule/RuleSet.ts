import {IRule, Triggerable, Rule, RuleJSONConfig, RuleResult} from "./index";
import {isRuleConfig} from "./index.guard";
import {Comment, Submission} from "snoowrap";
import {ruleFactory} from "./RuleFactory";
import {RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import {RepeatSubmissionJSONConfig} from "./SubmissionRule/RepeatSubmissionRule";
import {createLabelledLogger, determineNewResults, findResultByPremise, loggerMetaShuffle} from "../util";
import {Logger} from "winston";
import {AuthorRuleJSONConfig} from "./AuthorRule";
import {JoinCondition, JoinOperands} from "../Common/interfaces";

export class RuleSet implements IRuleSet, Triggerable {
    rules: Rule[] = [];
    condition: JoinOperands;
    logger: Logger;

    constructor(options: RuleSetOptions) {
        const {logger, condition = 'AND', rules = []} = options;
        if (logger !== undefined) {
            this.logger = logger.child(loggerMetaShuffle(logger, 'Rule Set'));
        } else {
            this.logger = createLabelledLogger('Rule Set');
        }
        this.condition = condition;
        for (const r of rules) {
            if (r instanceof Rule) {
                this.rules.push(r);
            } else if (isRuleConfig(r)) {
                // @ts-ignore
                r.logger = this.logger;
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

export interface IRuleSet extends JoinCondition {
    /**
     * @minItems 1
     * */
    rules: IRule[];
}

export interface RuleSetOptions extends IRuleSet {
    rules: Array<IRule | RuleJSONConfig>,
    logger?: Logger
}

/**
 * A RuleSet is a "nested" set of Rules that can be used to create more complex AND/OR behavior. Think of the outcome of a RuleSet as the result of all of it's Rules (based on condition)
 * @see {isRuleSetConfig} ts-auto-guard:type-guard
 * */
export interface RuleSetJSONConfig extends IRuleSet {
    /**
     * @minItems 1
     * */
    rules: Array<RecentActivityRuleJSONConfig | RepeatSubmissionJSONConfig | AuthorRuleJSONConfig>
}
