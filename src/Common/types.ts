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

export type RuleJson = RecentActivityRuleJSONConfig | RepeatActivityJSONConfig | AuthorRuleJSONConfig | AttributionJSONConfig | HistoryJSONConfig | RegexRuleJSONConfig | RepostRuleJSONConfig | string;
export type RuleObjectJson = Exclude<RuleJson, string>

export type ActionJson = CommentActionJson | FlairActionJson | ReportActionJson | LockActionJson | RemoveActionJson | ApproveActionJson | BanActionJson | UserNoteActionJson | MessageActionJson | UserFlairActionJson | string;
export type ActionObjectJson = Exclude<ActionJson, string>;

// borrowed from https://github.com/jabacchetta/set-random-interval/blob/master/src/index.ts
export type SetRandomInterval = (
    intervalFunction: () => void,
    minDelay: number,
    maxDelay: number,
) => { clear: () => void };

export type ConfigFormat = 'json' | 'yaml';
