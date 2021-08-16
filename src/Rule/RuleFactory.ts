import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatActivityRule, {RepeatActivityJSONConfig} from "./RepeatActivityRule";
import {Rule, RuleJSONConfig} from "./index";
import AuthorRule, {AuthorRuleJSONConfig} from "./AuthorRule";
import {AttributionJSONConfig, AttributionRule} from "./AttributionRule";
import {Logger} from "winston";
import HistoryRule, {HistoryJSONConfig} from "./HistoryRule";
import RegexRule, {RegexRuleJSONConfig} from "./RegexRule";
import {SubredditResources} from "../Subreddit/SubredditResources";
import Snoowrap from "snoowrap";

export function ruleFactory
(config: RuleJSONConfig, logger: Logger, subredditName: string, resources: SubredditResources, client: Snoowrap): Rule {
    let cfg;
    switch (config.kind) {
        case 'recentActivity':
            cfg = config as RecentActivityRuleJSONConfig;
            return new RecentActivityRule({...cfg, logger, subredditName, resources, client});
        case 'repeatActivity':
            cfg = config as RepeatActivityJSONConfig;
            return new RepeatActivityRule({...cfg, logger, subredditName, resources, client});
        case 'author':
            cfg = config as AuthorRuleJSONConfig;
            return new AuthorRule({...cfg, logger, subredditName, resources, client});
        case 'attribution':
            cfg = config as AttributionJSONConfig;
            return new AttributionRule({...cfg, logger, subredditName, resources, client});
        case 'history':
            cfg = config as HistoryJSONConfig;
            return new HistoryRule({...cfg, logger, subredditName, resources, client});
        case 'regex':
            cfg = config as RegexRuleJSONConfig;
            return new RegexRule({...cfg, logger, subredditName, resources, client});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
