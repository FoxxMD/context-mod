import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatActivityRule, {RepeatActivityJSONConfig} from "./SubmissionRule/RepeatActivityRule";
import {Rule, RuleJSONConfig} from "./index";
import AuthorRule, {AuthorRuleJSONConfig} from "./AuthorRule";
import {AttributionJSONConfig, AttributionRule} from "./SubmissionRule/AttributionRule";
import {Logger} from "winston";

export function ruleFactory
(config: RuleJSONConfig, logger: Logger): Rule {
    let cfg;
    switch (config.kind) {
        case 'recentActivity':
            cfg = config as RecentActivityRuleJSONConfig;
            return new RecentActivityRule({...cfg, logger});
        case 'repeatActivity':
            cfg = config as RepeatActivityJSONConfig;
            return new RepeatActivityRule({...cfg, logger});
        case 'author':
            cfg = config as AuthorRuleJSONConfig;
            return new AuthorRule({...cfg, logger});
        case 'attribution':
            cfg = config as AttributionJSONConfig;
            return new AttributionRule({...cfg, logger});
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
