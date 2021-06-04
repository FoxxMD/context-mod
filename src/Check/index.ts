import {RuleSet, IRuleSet, RuleSetJSONConfig} from "../Rule/RuleSet";
import {IRule, Triggerable, Rule, RuleJSONConfig, RuleResult} from "../Rule";
import Action, {ActionConfig, ActionJSONConfig} from "../Action";
import {Logger} from "winston";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RecentActivityRuleJSONConfig} from "../Rule/RecentActivityRule";
import {RepeatSubmissionJSONConfig} from "../Rule/SubmissionRule/RepeatSubmissionRule";
import {FlairActionJSONConfig} from "../Action/SubmissionAction/FlairAction";
import {CommentActionJSONConfig} from "../Action/CommentAction";
import {actionFactory} from "../Action/ActionFactory";
import {ruleFactory} from "../Rule/RuleFactory";
import {createLabelledLogger, determineNewResults, loggerMetaShuffle, mergeArr} from "../util";
import {AuthorRuleJSONConfig} from "../Rule/AuthorRule";
import {ReportActionJSONConfig} from "../Action/ReportAction";
import {LockActionJSONConfig} from "../Action/LockAction";
import {RemoveActionJSONConfig} from "../Action/RemoveAction";
import {JoinCondition, JoinOperands} from "../Common/interfaces";
import * as RuleSchema from '../Schema/Rule.json';
import * as RuleSetSchema from '../Schema/RuleSet.json';
import * as ActionSchema from '../Schema/Action.json';
import Ajv from 'ajv';

const ajv = new Ajv();

export class Check implements ICheck {
    actions: Action[] = [];
    description?: string;
    name: string;
    condition: JoinOperands;
    rules: Array<RuleSet | Rule> = [];
    logger: Logger;

    constructor(options: CheckOptions) {
        const {
            name,
            description,
            condition = 'AND',
            rules = [],
            actions = [],
        } = options;

        if (options.logger !== undefined) {
            // @ts-ignore
            this.logger = options.logger.child(loggerMetaShuffle(options.logger, undefined, [`CHK ${name}`]), mergeArr);
        } else {
            this.logger = createLabelledLogger('Check');
        }

        this.name = name;
        this.description = description;
        this.condition = condition;
        for (const r of rules) {
            if (r instanceof Rule || r instanceof RuleSet) {
                this.rules.push(r);
            } else {
                let valid = ajv.validate(RuleSetSchema, r);
                let setErrors: any = [];
                let ruleErrors: any = [];
                if (valid) {
                    // @ts-ignore
                    r.logger = this.logger;
                    this.rules.push(new RuleSet(r as RuleSetJSONConfig));
                } else {
                    setErrors = ajv.errors;
                    valid = ajv.validate(RuleSchema, r);
                    if (valid) {
                        // @ts-ignore
                        r.logger = this.logger;
                        this.rules.push(ruleFactory(r as RuleJSONConfig));
                    } else {
                        ruleErrors = ajv.errors;
                        const leastErrorType = setErrors.length < ruleErrors ? 'RuleSet' : 'Rule';
                        const errors = setErrors.length < ruleErrors ? setErrors : ruleErrors;
                        this.logger.warn(`Could not parse object as RuleSet or Rule json. ${leastErrorType} validation had least errors`, {}, {
                            errors,
                            obj: r
                        });
                    }
                }
            }
        }

        for (const a of actions) {
            if (a instanceof Action) {
                this.actions.push(a);
            } else {
                let valid = ajv.validate(ActionSchema, a);
                if (valid) {
                    this.actions.push(actionFactory(a as ActionJSONConfig));
                    // @ts-ignore
                    a.logger = this.logger;
                } else {
                    this.logger.warn('Could not parse object as Action', {}, {error: ajv.errors, obj: a})
                }
            }
        }


    }

    async run(item: Submission | Comment, existingResults: RuleResult[] = []): Promise<[boolean, RuleResult[]]> {
        this.logger.debug('Starting check');
        let allResults: RuleResult[] = [];
        let runOne = false;
        for (const r of this.rules) {
            const combinedResults = [...existingResults, ...allResults];
            const [passed, results] = await r.run(item, combinedResults);
            //allResults = allResults.concat(determineNewResults(combinedResults, results));
            allResults = allResults.concat(results);
            if (passed === null) {
                continue;
            }
            runOne = true;
            if (passed) {
                if (this.condition === 'OR') {
                    return [true, allResults];
                }
            } else if (this.condition === 'AND') {
                return [false, allResults];
            }
        }
        if (!runOne) {
            return [false, allResults];
        }
        return [true, allResults];
    }

    async runActions(item: Submission | Comment, ruleResults: RuleResult[]): Promise<void> {
        for (const a of this.actions) {
            await a.handle(item, ruleResults);
        }
    }
}

export interface ICheck extends JoinCondition {
    /**
     * Friendly name for this Check EX "crosspostSpamCheck"
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * */
    name: string,
    description?: string,
}

export interface CheckOptions extends ICheck {
    rules: Array<IRuleSet | IRule>
    actions: ActionConfig[]
    logger?: Logger
}

/**
 * An object consisting of Rules (tests) and Actions to perform if Rules are triggered
 * @see {isCheckConfig} ts-auto-guard:type-guard
 * */
export interface CheckJSONConfig extends ICheck {
    /**
     * The type of event (new submission or new comment) this check should be run against
     */
    kind: 'submission' | 'comment'
    /**
     * Rules are run in the order found in configuration. Can be Rules or RuleSets
     * @minItems 1
     * */
    rules: Array<RuleSetJSONConfig | RecentActivityRuleJSONConfig | RepeatSubmissionJSONConfig | AuthorRuleJSONConfig>
    /**
     * The actions to run after the check is successfully triggered. ALL actions will run in the order they are listed
     * @minItems 1
     * */
    actions: Array<FlairActionJSONConfig | CommentActionJSONConfig | ReportActionJSONConfig | LockActionJSONConfig | RemoveActionJSONConfig>
}
