import {CommentAction, CommentActionJson} from "./CommentAction";
import LockAction from "./LockAction";
import {RemoveAction} from "./RemoveAction";
import {ReportAction, ReportActionJson} from "./ReportAction";
import {FlairAction, FlairActionJson} from "./SubmissionAction/FlairAction";
import Action, {ActionJson} from "./index";
import {Logger} from "winston";
import {UserNoteAction, UserNoteActionJson} from "./UserNoteAction";
import ApproveAction, {ApproveActionConfig} from "./ApproveAction";
import BanAction, {BanActionJson} from "./BanAction";
import {MessageAction, MessageActionJson} from "./MessageAction";
import {SubredditResources} from "../Subreddit/SubredditResources";
import {UserFlairAction, UserFlairActionJson} from './UserFlairAction';
import {ExtendedSnoowrap} from '../Utils/SnoowrapClients';

export function actionFactory
(config: ActionJson, logger: Logger, subredditName: string, resources: SubredditResources, client: ExtendedSnoowrap): Action {
    switch (config.kind) {
        case 'comment':
            return new CommentAction({...config as CommentActionJson, logger, subredditName, resources, client});
        case 'lock':
            return new LockAction({...config, logger, subredditName, resources, client});
        case 'remove':
            return new RemoveAction({...config, logger, subredditName, resources, client});
        case 'report':
            return new ReportAction({...config as ReportActionJson, logger, subredditName, resources, client});
        case 'flair':
            return new FlairAction({...config as FlairActionJson, logger, subredditName, resources, client});
        case 'userflair':
            return new UserFlairAction({...config as UserFlairActionJson, logger, subredditName, resources, client});
        case 'approve':
            return new ApproveAction({...config as ApproveActionConfig, logger, subredditName, resources, client});
        case 'usernote':
            return new UserNoteAction({...config as UserNoteActionJson, logger, subredditName, resources, client});
        case 'ban':
            return new BanAction({...config as BanActionJson, logger, subredditName, resources, client});
        case 'message':
            return new MessageAction({...config as MessageActionJson, logger, subredditName, resources, client});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
