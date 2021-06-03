import {RuleSet, IRuleSet, RuleSetJSONConfig} from "../Rule/RuleSet";
import {IRule, Triggerable, Rule, RuleJSONConfig, RuleResult} from "../Rule";
import Action, {ActionConfig, ActionJSONConfig} from "../Action";
import {isRuleSetConfig} from "../Rule/RuleSet.guard";
import {isRuleConfig} from "../Rule/index.guard";
import {Logger} from "winston";
import {isActionConfig} from "../Action/index.guard";
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
            } else if (isRuleSetConfig(r)) {
                this.rules.push(new RuleSet(r));
            } else if (isRuleConfig(r)) {
                // @ts-ignore
                r.logger = this.logger;
                this.rules.push(ruleFactory(r));
            }
        }

        for (const a of actions) {
            if (a instanceof Action) {
                this.actions.push(a);
            } else if (isActionConfig(a)) {
                this.actions.push(actionFactory(a));
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

    async runActions(item: Submission | Comment, client: Snoowrap): Promise<void> {
        for (const a of this.actions) {
            await a.handle(item, client);
        }
    }
}

export interface ICheck extends JoinCondition {
    /**
     * A friendly name for this check (highly recommended) -- EX "repeatCrosspostReport"
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
