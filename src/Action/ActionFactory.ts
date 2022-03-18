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
import EventEmitter from "events";
import {DispatchAction, DispatchActionJson} from "./DispatchAction";
import {CancelDispatchAction, CancelDispatchActionJson} from "./CancelDispatchAction";
import {ModNoteAction, ModNoteActionJson} from "./ModNoteAction";

export function actionFactory
(config: ActionJson, logger: Logger, subredditName: string, resources: SubredditResources, client: ExtendedSnoowrap, emitter: EventEmitter): Action {
    switch (config.kind) {
        case 'comment':
            return new CommentAction({...config as CommentActionJson, logger, subredditName, resources, client, emitter});
        case 'lock':
            return new LockAction({...config, logger, subredditName, resources, client, emitter});
        case 'remove':
            return new RemoveAction({...config, logger, subredditName, resources, client, emitter});
        case 'report':
            return new ReportAction({...config as ReportActionJson, logger, subredditName, resources, client, emitter});
        case 'flair':
            return new FlairAction({...config as FlairActionJson, logger, subredditName, resources, client, emitter});
        case 'userflair':
            return new UserFlairAction({...config as UserFlairActionJson, logger, subredditName, resources, client, emitter});
        case 'approve':
            return new ApproveAction({...config as ApproveActionConfig, logger, subredditName, resources, client, emitter});
        case 'usernote':
            return new UserNoteAction({...config as UserNoteActionJson, logger, subredditName, resources, client, emitter});
        case 'ban':
            return new BanAction({...config as BanActionJson, logger, subredditName, resources, client, emitter});
        case 'message':
            return new MessageAction({...config as MessageActionJson, logger, subredditName, resources, client, emitter});
        case 'dispatch':
            return new DispatchAction({...config as DispatchActionJson, logger, subredditName, resources, client, emitter});
        case 'cancelDispatch':
            return new CancelDispatchAction({...config as CancelDispatchActionJson, logger, subredditName, resources, client, emitter});
        case 'modnote':
            return new ModNoteAction({...config as ModNoteActionJson, logger, subredditName, resources, client, emitter})
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
