import {CommentAction, CommentActionJson} from "./CommentAction";
import LockAction from "./LockAction";
import {RemoveAction} from "./RemoveAction";
import {ReportAction, ReportActionJson} from "./ReportAction";
import {FlairAction, FlairActionJson} from "./SubmissionAction/FlairAction";
import Action, {ActionJson} from "./index";
import {Logger} from "winston";

export function actionFactory
(config: ActionJson, logger: Logger): Action {
    let cfg;
    switch (config.kind) {
        case 'comment':
            cfg = config as CommentActionJson;
            return new CommentAction({...cfg, logger});
        case 'lock':
            return new LockAction({logger});
        case 'remove':
            return new RemoveAction({logger});
        case 'report':
            cfg = config as ReportActionJson;
            return new ReportAction({...cfg, logger});
        case 'flair':
            cfg = config as FlairActionJson;
            return new FlairAction({...cfg, logger});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
