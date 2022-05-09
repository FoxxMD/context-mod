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
import {SafeDictionary} from "ts-essentials";
import {FilterCriteriaPropertyResult, StructuredRunnableBase} from "./interfaces";
import {ContributorActionJson} from "../Action/ContributorAction";
import {RuleSetObjectJson} from "../Rule/RuleSet";
import {AuthorCriteria} from "./Typings/Filters/FilterCriteria";

export type RuleObjectJsonTypes = RecentActivityRuleJSONConfig | RepeatActivityJSONConfig | AuthorRuleJSONConfig | AttributionJSONConfig | HistoryJSONConfig | RegexRuleJSONConfig | RepostRuleJSONConfig
export type RuleJson = RuleObjectJsonTypes | string;
export type RuleObjectJson = Exclude<RuleJson, string>
export type StructuredRuleObjectJson = Omit<RuleObjectJson, 'authorIs' | 'itemIs'> & StructuredRunnableBase

export type StructuredRuleSetObjectJson = Omit<RuleSetObjectJson, 'rules'> & {
    rules: StructuredRuleObjectJson[]
}

export type ActionJson = CommentActionJson | FlairActionJson | ReportActionJson | LockActionJson | RemoveActionJson | ApproveActionJson | BanActionJson | UserNoteActionJson | MessageActionJson | UserFlairActionJson | DispatchActionJson | CancelDispatchActionJson | ContributorActionJson | string;
export type ActionObjectJson = Exclude<ActionJson, string>;
export type StructuredActionObjectJson = Omit<ActionObjectJson, 'authorIs' | 'itemIs'> & StructuredRunnableBase

// borrowed from https://github.com/jabacchetta/set-random-interval/blob/master/src/index.ts
export type SetRandomInterval = (
    intervalFunction: () => void,
    minDelay: number,
    maxDelay: number,
) => { clear: () => void };

export type ConfigFormat = 'json' | 'yaml';

export type AuthorCritPropHelper = SafeDictionary<FilterCriteriaPropertyResult<AuthorCriteria>, keyof AuthorCriteria>;
export type RequiredAuthorCrit = Required<AuthorCriteria>;

export type ActionTypes = 'comment' | 'lock' | 'remove' | 'report' | 'approve' | 'ban' | 'flair' | 'usernote' | 'message' | 'userflair' | 'dispatch' | 'cancelDispatch' | 'contributor';
