import {IRule, Triggerable, Rule, RuleJSONConfig, RuleResult} from "./index";
import {Comment, Submission} from "snoowrap";
import {ruleFactory} from "./RuleFactory";
import {createAjvFactory, mergeArr} from "../util";
import {Logger} from "winston";
import {JoinCondition, JoinOperands} from "../Common/interfaces";
import * as RuleSchema from '../Schema/Rule.json';
import Ajv from 'ajv';
import {RuleJson, RuleObjectJson} from "../Common/types";

export class RuleSet implements IRuleSet, Triggerable {
    rules: Rule[] = [];
    condition: JoinOperands;
    logger: Logger;

    constructor(options: RuleSetOptions) {
        const {logger, condition = 'AND', rules = []} = options;
        this.logger = logger.child({leaf: 'Rule Set'}, mergeArr);
        this.condition = condition;
        const ajv = createAjvFactory(this.logger);
        for (const r of rules) {
            if (r instanceof Rule) {
                this.rules.push(r);
            } else {
                const valid = ajv.validate(RuleSchema, r);
                if (valid) {
                    this.rules.push(ruleFactory(r as RuleJSONConfig, logger, options.subredditName));
                } else {
                    this.logger.warn('Could not build rule because of JSON errors', {}, {errors: ajv.errors, obj: r});
                }
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
        if(this.condition === 'OR') {
            // if OR and did not return already then none passed
            return [false, results];
        }
        // otherwise AND and did not return already so all passed
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
    logger: Logger
    subredditName: string
}

/**
 * A RuleSet is a "nested" set of `Rule` objects that can be used to create more complex AND/OR behavior. Think of the outcome of a `RuleSet` as the result of all of its run `Rule` objects (based on `condition`)
 * */
export interface RuleSetJson extends JoinCondition {
    /**
     * Can be `Rule` or the `name` of any **named** `Rule` in your subreddit's configuration
     * @minItems 1
     * */
    rules: Array<RuleJson>
}

export interface RuleSetObjectJson extends RuleSetJson {
    rules: Array<RuleObjectJson>
}

export const isRuleSetJSON = (obj: object): obj is RuleSetJson => {
    return (obj as RuleSetJson).rules !== undefined;
}
