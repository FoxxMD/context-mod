import {CommentAction, CommentActionJson} from "./CommentAction";
import LockAction from "./LockAction";
import {RemoveAction} from "./RemoveAction";
import {ReportAction, ReportActionJson} from "./ReportAction";
import {FlairAction, FlairActionJson} from "./SubmissionAction/FlairAction";
import Action, {ActionJson} from "./index";
import {Logger} from "winston";
import {UserNoteAction, UserNoteActionJson} from "./UserNoteAction";
import ApproveAction, {ApproveActionConfig} from "./ApproveAction";

export function actionFactory
(config: ActionJson, logger: Logger, subredditName: string): Action {
    switch (config.kind) {
        case 'comment':
            return new CommentAction({...config as CommentActionJson, logger, subredditName});
        case 'lock':
            return new LockAction({...config, logger, subredditName});
        case 'remove':
            return new RemoveAction({...config, logger, subredditName});
        case 'report':
            return new ReportAction({...config as ReportActionJson, logger, subredditName});
        case 'flair':
            return new FlairAction({...config as FlairActionJson, logger, subredditName});
        case 'approve':
            return new ApproveAction({...config as ApproveActionConfig, logger, subredditName});
        case 'usernote':
            return new UserNoteAction({...config as UserNoteActionJson, logger, subredditName});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
