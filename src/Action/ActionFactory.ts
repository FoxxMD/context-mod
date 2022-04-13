import {CommentAction, CommentActionJson} from "./CommentAction";
import LockAction, {LockActionJson} from "./LockAction";
import {RemoveAction, RemoveActionJson} from "./RemoveAction";
import {ReportAction, ReportActionJson} from "./ReportAction";
import {FlairAction, FlairActionJson} from "./SubmissionAction/FlairAction";
import Action, {ActionJson, StructuredActionJson} from "./index";
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
import ContributorAction, {ContributorActionJson} from "./ContributorAction";
import {StructuredFilter} from "../Common/interfaces";

export function actionFactory
(config: StructuredActionJson, logger: Logger, subredditName: string, resources: SubredditResources, client: ExtendedSnoowrap, emitter: EventEmitter): Action {
    switch (config.kind) {
        case 'comment':
            return new CommentAction({...config as StructuredFilter<CommentActionJson>, logger, subredditName, resources, client, emitter});
        case 'lock':
            return new LockAction({...config as StructuredFilter<LockActionJson>, logger, subredditName, resources, client, emitter});
        case 'remove':
            return new RemoveAction({...config as StructuredFilter<RemoveActionJson>, logger, subredditName, resources, client, emitter});
        case 'report':
            return new ReportAction({...config as StructuredFilter<ReportActionJson>, logger, subredditName, resources, client, emitter});
        case 'flair':
            return new FlairAction({...config as StructuredFilter<FlairActionJson>, logger, subredditName, resources, client, emitter});
        case 'userflair':
            return new UserFlairAction({...config as StructuredFilter<UserFlairActionJson>, logger, subredditName, resources, client, emitter});
        case 'approve':
            return new ApproveAction({...config as StructuredFilter<ApproveActionConfig>, logger, subredditName, resources, client, emitter});
        case 'usernote':
            return new UserNoteAction({...config as StructuredFilter<UserNoteActionJson>, logger, subredditName, resources, client, emitter});
        case 'ban':
            return new BanAction({...config as StructuredFilter<BanActionJson>, logger, subredditName, resources, client, emitter});
        case 'message':
            return new MessageAction({...config as StructuredFilter<MessageActionJson>, logger, subredditName, resources, client, emitter});
        case 'dispatch':
            return new DispatchAction({...config as StructuredFilter<DispatchActionJson>, logger, subredditName, resources, client, emitter});
        case 'cancelDispatch':
            return new CancelDispatchAction({...config as StructuredFilter<CancelDispatchActionJson>, logger, subredditName, resources, client, emitter})
        case 'contributor':
            return new ContributorAction({...config as StructuredFilter<ContributorActionJson>, logger, subredditName, resources, client, emitter})
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
