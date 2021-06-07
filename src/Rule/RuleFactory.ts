import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatActivityRule, {RepeatActivityJSONConfig} from "./SubmissionRule/RepeatActivityRule";
import {Rule, RuleJSONConfig} from "./index";
import AuthorRule, {AuthorRuleJSONConfig} from "./AuthorRule";
import {AttributionJSONConfig, AttributionRule} from "./SubmissionRule/AttributionRule";

export function ruleFactory
(config: RuleJSONConfig): Rule {
    switch (config.kind) {
        case 'recentActivity':
            return new RecentActivityRule(config as RecentActivityRuleJSONConfig);
        case 'repeatActivity':
            return new RepeatActivityRule(config as RepeatActivityJSONConfig);
        case 'author':
            return new AuthorRule(config as AuthorRuleJSONConfig);
        case 'attribution':
            return new AttributionRule(config as AttributionJSONConfig);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
