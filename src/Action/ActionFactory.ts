import {CommentAction, CommentActionJSONConfig} from "./CommentAction";
import LockAction from "./LockAction";
import {RemoveAction} from "./RemoveAction";
import {ReportAction, ReportActionJSONConfig} from "./ReportAction";
import {FlairAction, FlairActionJSONConfig} from "./SubmissionAction/FlairAction";
import Action, {ActionJSONConfig} from "./index";

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
