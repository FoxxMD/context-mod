import {IRule, Triggerable, Rule, RuleJSONConfig, StructuredRuleJson} from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {ruleFactory} from "./RuleFactory";
import {createAjvFactory, mergeArr} from "../util";
import {Logger} from "winston";
import {JoinCondition, RuleResult, RuleSetResult} from "../Common/interfaces";
import * as RuleSchema from '../Schema/Rule.json';
import Ajv from 'ajv';
import {SubredditResources} from "../Subreddit/SubredditResources";
import {runCheckOptions} from "../Subreddit/Manager";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {RuleSetResultEntity} from "../Common/Entities/RuleSetResultEntity";
import {JoinOperands} from "../Common/Infrastructure/Atomic";
import {
    RuleConfigData,
    RuleConfigHydratedData,
    RuleConfigObject,
    StructuredRuleConfigObject
} from "../Common/Infrastructure/RuleShapes";

export class RuleSet implements IRuleSet {
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
                    this.rules.push(ruleFactory(r, logger, options.subredditName, options.resources, options.client));
                } else {
                    this.logger.warn('Could not build rule because of JSON errors', {}, {errors: ajv.errors, obj: r});
                }
            }
        }
    }

    async run(item: Comment | Submission, existingResults: RuleResultEntity[] = [], options: runCheckOptions): Promise<[boolean, RuleSetResult]> {
        let results: RuleResultEntity[] = [];
        let runOne = false;
        const combinedResults = [...existingResults];
        for (const r of this.rules) {
            if(results.length > 0) {
                combinedResults.push(results.slice(results.length - 1)[0]);
            }
            //const combinedResults = [...existingResults, ...results];
            const [passed, result] = await r.run(item, combinedResults, options);
            //results = results.concat(determineNewResults(combinedResults, result));
            results.push(result);
            // skip rule if author check failed
            if (passed === null) {
                continue;
            }
            runOne = true;
            if (passed) {
                if (this.condition === 'OR') {
                    return [true, this.generateResultSet(true, results)];
                }
            } else if (this.condition === 'AND') {
                return [false, this.generateResultSet(false, results)];
            }
        }
        // if no rules were run it's the same as if nothing was triggered
        if (!runOne) {
            return [false, this.generateResultSet(false, results)];
        }
        if(this.condition === 'OR') {
            // if OR and did not return already then none passed
            return [false, this.generateResultSet(false, results)];
        }
        // otherwise AND and did not return already so all passed
        return [true, this.generateResultSet(true, results)];
    }

    generateResultSet(triggered: boolean, results: RuleResultEntity[]): RuleSetResult {
        return {
            results,
            triggered,
            condition: this.condition
        };
    }

    // generateResultSet(triggered: boolean, results: RuleResultEntity[]): RuleSetResult {
    //     return new RuleSetResultEntity({
    //         triggered,
    //         condition: this.condition,
    //         ruleResults: results
    //     });
    // }
}

export interface IRuleSet extends JoinCondition {
    /**
     * @minItems 1
     * */
    rules: IRule[];
}

export interface RuleSetOptions extends IRuleSet {
    rules: Array<StructuredRuleConfigObject>,
    logger: Logger
    subredditName: string
    resources: SubredditResources
    client: Snoowrap
}

/**
 * A RuleSet is a "nested" set of `Rule` objects that can be used to create more complex AND/OR behavior. Think of the outcome of a `RuleSet` as the result of all of its run `Rule` objects (based on `condition`)
 * */
export interface RuleSetConfigData extends JoinCondition {
    /**
     * Can be `Rule` or the `name` of any **named** `Rule` in your subreddit's configuration
     * @minItems 1
     * */
    rules: RuleConfigData[]
}

export interface RuleSetConfigHydratedData extends RuleSetConfigData {
    rules: RuleConfigHydratedData[]
}

export interface RuleSetConfigObject extends RuleSetConfigHydratedData {
    rules: RuleConfigObject[]
}

export const isRuleSetJSON = (obj: object): obj is RuleSetConfigData => {
    return (obj as RuleSetConfigData).rules !== undefined;
}

export const isRuleSet = (obj: object): obj is RuleSet => {
    return (obj as RuleSet).rules !== undefined;
}
