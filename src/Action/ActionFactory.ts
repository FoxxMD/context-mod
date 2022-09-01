import {CommentAction, CommentActionJson} from "./CommentAction";
import LockAction, {LockActionJson} from "./LockAction";
import {RemoveAction, RemoveActionJson} from "./RemoveAction";
import {ReportAction, ReportActionJson} from "./ReportAction";
import {FlairAction, FlairActionJson} from "./SubmissionAction/FlairAction";
import Action, {ActionJson, ActionRuntimeOptions, StructuredActionJson} from "./index";
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
import {StructuredFilter} from "../Common/Infrastructure/Filters/FilterShapes";
import {ModNoteAction, ModNoteActionJson} from "./ModNoteAction";
import {SubmissionAction, SubmissionActionJson} from "./SubmissionAction";

export function actionFactory
(config: StructuredActionJson, runtimeOptions: ActionRuntimeOptions): Action {
    switch (config.kind) {
        case 'comment':
            return new CommentAction({...config as StructuredFilter<CommentActionJson>, ...runtimeOptions});
        case 'submission':
            return new SubmissionAction({...config as StructuredFilter<SubmissionActionJson>, ...runtimeOptions});
        case 'lock':
            return new LockAction({...config as StructuredFilter<LockActionJson>, ...runtimeOptions});
        case 'remove':
            return new RemoveAction({...config as StructuredFilter<RemoveActionJson>, ...runtimeOptions});
        case 'report':
            return new ReportAction({...config as StructuredFilter<ReportActionJson>, ...runtimeOptions});
        case 'flair':
            return new FlairAction({...config as StructuredFilter<FlairActionJson>, ...runtimeOptions});
        case 'userflair':
            return new UserFlairAction({...config as StructuredFilter<UserFlairActionJson>, ...runtimeOptions});
        case 'approve':
            return new ApproveAction({...config as StructuredFilter<ApproveActionConfig>, ...runtimeOptions});
        case 'usernote':
            return new UserNoteAction({...config as StructuredFilter<UserNoteActionJson>, ...runtimeOptions});
        case 'ban':
            return new BanAction({...config as StructuredFilter<BanActionJson>, ...runtimeOptions});
        case 'message':
            return new MessageAction({...config as StructuredFilter<MessageActionJson>, ...runtimeOptions});
        case 'dispatch':
            return new DispatchAction({...config as StructuredFilter<DispatchActionJson>, ...runtimeOptions});
        case 'cancelDispatch':
            return new CancelDispatchAction({...config as StructuredFilter<CancelDispatchActionJson>, ...runtimeOptions})
        case 'contributor':
            return new ContributorAction({...config as StructuredFilter<ContributorActionJson>, ...runtimeOptions})
        case 'modnote':
            return new ModNoteAction({...config as StructuredFilter<ModNoteActionJson>, ...runtimeOptions})
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
