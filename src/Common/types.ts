import {RecentActivityRuleJSONConfig} from "../Rule/RecentActivityRule";
import {RepeatActivityJSONConfig} from "../Rule/RepeatActivityRule";
import {AuthorRuleJSONConfig} from "../Rule/AuthorRule";
import {AttributionJSONConfig} from "../Rule/AttributionRule";
import {FlairActionJson} from "../Action/SubmissionAction/FlairAction";
import {UserFlairActionJson} from "../Action/UserFlairAction";
import {CommentActionJson} from "../Action/CommentAction";
import {ReportActionJson} from "../Action/ReportAction";
import {LockActionJson} from "../Action/LockAction";
import {RemoveActionJson} from "../Action/RemoveAction";
import {HistoryJSONConfig} from "../Rule/HistoryRule";
import {UserNoteActionJson} from "../Action/UserNoteAction";
import {ApproveActionJson} from "../Action/ApproveAction";
import {BanActionJson} from "../Action/BanAction";
import {RegexRuleJSONConfig} from "../Rule/RegexRule";
import {MessageActionJson} from "../Action/MessageAction";
import {RepostRuleJSONConfig} from "../Rule/RepostRule";
import {DispatchActionJson} from "../Action/DispatchAction";
import {CancelDispatchActionJson} from "../Action/CancelDispatchAction";
import {ContributorActionJson} from "../Action/ContributorAction";
import {SentimentRuleJSONConfig} from "../Rule/SentimentRule";
import {ModNoteActionJson} from "../Action/ModNoteAction";
import {IncludesData} from "./Infrastructure/Includes";

export type RuleObjectJsonTypes = RecentActivityRuleJSONConfig | RepeatActivityJSONConfig | AuthorRuleJSONConfig | AttributionJSONConfig | HistoryJSONConfig | RegexRuleJSONConfig | RepostRuleJSONConfig | SentimentRuleJSONConfig

export type ActionJson = CommentActionJson | FlairActionJson | ReportActionJson | LockActionJson | RemoveActionJson | ApproveActionJson | BanActionJson | UserNoteActionJson | MessageActionJson | UserFlairActionJson | DispatchActionJson | CancelDispatchActionJson | ContributorActionJson | ModNoteActionJson | string | IncludesData;
