import {CommentAction, CommentActionJson} from "./CommentAction";
import LockAction from "./LockAction";
import {RemoveAction} from "./RemoveAction";
import {ReportAction, ReportActionJson} from "./ReportAction";
import {FlairAction, FlairActionJson} from "./SubmissionAction/FlairAction";
import Action, {ActionJson} from "./index";
import {Logger} from "winston";

export function actionFactory
(config: ActionJson, logger: Logger, subredditName: string): Action {
    let cfg;
    switch (config.kind) {
        case 'comment':
            cfg = config as CommentActionJson;
            return new CommentAction({...cfg, logger, subredditName});
        case 'lock':
            return new LockAction({logger, subredditName});
        case 'remove':
            return new RemoveAction({logger, subredditName});
        case 'report':
            cfg = config as ReportActionJson;
            return new ReportAction({...cfg, logger, subredditName});
        case 'flair':
            cfg = config as FlairActionJson;
            return new FlairAction({...cfg, logger, subredditName});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
