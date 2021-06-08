import {CommentAction, CommentActionJson} from "./CommentAction";
import LockAction from "./LockAction";
import {RemoveAction} from "./RemoveAction";
import {ReportAction, ReportActionJson} from "./ReportAction";
import {FlairAction, FlairActionJson} from "./SubmissionAction/FlairAction";
import Action, {ActionJson} from "./index";

export function actionFactory
(config: ActionJson): Action {
    switch (config.kind) {
        case 'comment':
            return new CommentAction(config as CommentActionJson);
        case 'lock':
            return new LockAction();
        case 'remove':
            return new RemoveAction();
        case 'report':
            return new ReportAction(config as ReportActionJson);
        case 'flair':
            return new FlairAction(config as FlairActionJson);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
