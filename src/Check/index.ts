import {RuleSet, IRuleSet, RuleSetJSONConfig} from "../Rule/RuleSet";
import {IRule, Triggerable, Rule, RuleJSONConfig} from "../Rule";
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

export class Check implements ICheck {
    actions: Action[] = [];
    description?: string;
    name: string;
    ruleJoin: "OR" | "AND";
    rules: Array<RuleSet | Rule> = [];

    //logger: Logger;

    constructor(options: CheckOptions) {
        const {
            name,
            description,
            ruleJoin = 'AND',
            rules,
            actions,
        } = options;

        this.name = name;
        this.description = description;
        this.ruleJoin = ruleJoin;
        for (const r of rules) {
            if (r instanceof Rule || r instanceof RuleSet) {
                this.rules.push(r);
            } else if (isRuleSetConfig(r)) {
                this.rules.push(new RuleSet(r));
            } else if (isRuleConfig(r)) {
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

    async run(item: Submission | Comment): Promise<[boolean, Rule[]]> {
        let allRules: Rule[] = [];
        for (const r of this.rules) {
            const [passed, rules] = await r.run(item);
            if (passed) {
                if (this.ruleJoin === 'OR') {
                    return [true, rules];
                } else {
                    allRules = allRules.concat(rules);
                }
            } else if (this.ruleJoin === 'AND') {
                return [false, rules];
            }
        }
        return [true, allRules];
    }

    async runActions(item: Submission | Comment, client: Snoowrap): Promise<void> {
        for (const a of this.actions) {
            await a.handle(item, client);
        }
    }
}

export interface ICheck {
    name: string,
    description?: string,
    ruleJoin?: 'OR' | 'AND',
}

export interface CheckOptions extends ICheck {
    rules: Array<IRuleSet | IRule>
    actions: ActionConfig[]
}

/** @see {isCheckConfig} ts-auto-guard:type-guard */
export interface CheckJSONConfig extends ICheck {
    kind: 'submission' | 'comment'
    rules: Array<RuleSetJSONConfig | RecentActivityRuleJSONConfig | RepeatSubmissionJSONConfig>
    actions: Array<ActionJSONConfig | FlairActionJSONConfig | CommentActionJSONConfig>
}
