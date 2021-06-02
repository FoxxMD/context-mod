import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatSubmissionRule, {RepeatSubmissionJSONConfig} from "./SubmissionRule/RepeatSubmissionRule";
import {Rule, RuleJSONConfig} from "./index";
import AuthorRule, {AuthorRuleJSONConfig} from "./AuthorRule";

export function ruleFactory
(config: RuleJSONConfig): Rule {
    switch (config.kind) {
        case 'recentActivity':
            return new RecentActivityRule(config as RecentActivityRuleJSONConfig);
        case 'repeatSubmission':
            return new RepeatSubmissionRule(config as RepeatSubmissionJSONConfig);
        case 'author':
            return new AuthorRule(config as AuthorRuleJSONConfig);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
