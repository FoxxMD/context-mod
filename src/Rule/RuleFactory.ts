import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatActivityRule, {RepeatActivityJSONConfig} from "./RepeatActivityRule";
import {Rule, RuleJSONConfig, StructuredRuleJson} from "./index";
import AuthorRule, {AuthorRuleJSONConfig} from "./AuthorRule";
import {AttributionJSONConfig, AttributionRule} from "./AttributionRule";
import {Logger} from "winston";
import HistoryRule, {HistoryJSONConfig} from "./HistoryRule";
import RegexRule, {RegexRuleJSONConfig} from "./RegexRule";
import {SubredditResources} from "../Subreddit/SubredditResources";
import Snoowrap from "snoowrap";
import {RepostRule, RepostRuleJSONConfig} from "./RepostRule";
import {StructuredFilter} from "../Common/Infrastructure/Filters/FilterShapes";

export function ruleFactory
(config: StructuredRuleJson, logger: Logger, subredditName: string, resources: SubredditResources, client: Snoowrap): Rule {
    let cfg;
    switch (config.kind) {
        case 'recentActivity':
            cfg = config as StructuredFilter<RecentActivityRuleJSONConfig>;
            return new RecentActivityRule({...cfg, logger, subredditName, resources, client});
        case 'repeatActivity':
            cfg = config as StructuredFilter<RepeatActivityJSONConfig>;
            return new RepeatActivityRule({...cfg, logger, subredditName, resources, client});
        case 'author':
            cfg = config as StructuredFilter<AuthorRuleJSONConfig>;
            // @ts-ignore
            return new AuthorRule({...cfg, logger, subredditName, resources, client});
        case 'attribution':
            cfg = config as StructuredFilter<AttributionJSONConfig>;
            return new AttributionRule({...cfg, logger, subredditName, resources, client});
        case 'history':
            cfg = config as StructuredFilter<HistoryJSONConfig>;
            return new HistoryRule({...cfg, logger, subredditName, resources, client});
        case 'regex':
            cfg = config as StructuredFilter<RegexRuleJSONConfig>;
            return new RegexRule({...cfg, logger, subredditName, resources, client});
        case 'repost':
            cfg = config as StructuredFilter<RepostRuleJSONConfig>;
            return new RepostRule({...cfg, logger, subredditName, resources, client});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
