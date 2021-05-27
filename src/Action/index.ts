import Snoowrap, {Comment, Submission} from "snoowrap";
import {RecentActivityRule, RecentActivityRuleJSONConfig} from "../Rule/RecentActivityRule";
import RepeatSubmissionRule, {RepeatSubmissionJSONConfig} from "../Rule/SubmissionRule/RepeatSubmissionRule";
import {Rule, RuleJSONConfig} from "../Rule";
import {CommentAction, CommentActionJSONConfig} from "./CommentAction";
import LockAction, {LockActionJSONConfig} from "./LockAction";
import {RemoveAction} from "./RemoveAction";
import {ReportAction, ReportActionJSONConfig} from "./ReportAction";
import {FlairAction, FlairActionJSONConfig} from "./SubmissionAction/FlairAction";

export abstract class Action {
    abstract handle(item: Comment | Submission, client: Snoowrap): Promise<void>;
}

export interface ActionConfig {

}

/** @see {isActionConfig} ts-auto-guard:type-guard */
export interface ActionJSONConfig extends ActionConfig {
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'flair'
}

export default Action;

export function actionFactory
(config: ActionJSONConfig): Action {
    switch (config.kind) {
        case 'comment':
            return new CommentAction(config as CommentActionJSONConfig);
        case 'lock':
            return new LockAction();
        case 'remove':
            return new RemoveAction();
        case 'report':
            return new ReportAction(config as ReportActionJSONConfig);
        case 'flair':
            return new FlairAction(config as FlairActionJSONConfig);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
