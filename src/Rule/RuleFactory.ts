import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatActivityRule, {RepeatActivityJSONConfig} from "./SubmissionRule/RepeatActivityRule";
import {Rule, RuleJSONConfig} from "./index";
import AuthorRule, {AuthorRuleJSONConfig} from "./AuthorRule";
import {AttributionJSONConfig, AttributionRule} from "./AttributionRule";
import {Logger} from "winston";
import HistoryRule, {HistoryJSONConfig} from "./HistoryRule";

export function ruleFactory
(config: RuleJSONConfig, logger: Logger, subredditName: string): Rule {
    let cfg;
    switch (config.kind) {
        case 'recentActivity':
            cfg = config as RecentActivityRuleJSONConfig;
            return new RecentActivityRule({...cfg, logger, subredditName});
        case 'repeatActivity':
            cfg = config as RepeatActivityJSONConfig;
            return new RepeatActivityRule({...cfg, logger, subredditName});
        case 'author':
            cfg = config as AuthorRuleJSONConfig;
            return new AuthorRule({...cfg, logger, subredditName});
        case 'attribution':
            cfg = config as AttributionJSONConfig;
            return new AttributionRule({...cfg, logger, subredditName});
        case 'history':
            cfg = config as HistoryJSONConfig;
            return new HistoryRule({...cfg, logger, subredditName});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
