import {RecentActivityRuleJSONConfig} from "../Rule/RecentActivityRule";
import {RepeatActivityJSONConfig} from "../Rule/SubmissionRule/RepeatActivityRule";
import {AuthorRuleJSONConfig} from "../Rule/AuthorRule";
import {AttributionJSONConfig} from "../Rule/SubmissionRule/AttributionRule";
import {FlairActionJson} from "../Action/SubmissionAction/FlairAction";
import {CommentActionJson} from "../Action/CommentAction";
import {ReportActionJson} from "../Action/ReportAction";
import {LockActionJson} from "../Action/LockAction";
import {RemoveActionJson} from "../Action/RemoveAction";
import {HistoryJSONConfig} from "../Rule/HistoryRule";
import {UserNoteActionJson} from "../Action/UserNoteAction";

export type RuleJson = RecentActivityRuleJSONConfig | RepeatActivityJSONConfig | AuthorRuleJSONConfig | AttributionJSONConfig | HistoryJSONConfig | string;
export type RuleObjectJson = Exclude<RuleJson, string>

export type ActionJson = CommentActionJson | FlairActionJson | ReportActionJson | LockActionJson | RemoveActionJson | UserNoteActionJson | string;
export type ActionObjectJson = Exclude<ActionJson, string>;
