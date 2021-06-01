import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatSubmissionRule, {RepeatSubmissionJSONConfig} from "./SubmissionRule/RepeatSubmissionRule";
import {Rule, RuleJSONConfig} from "./index";

export function ruleFactory
(config: RuleJSONConfig): Rule {
    switch (config.kind) {
        case 'recentActivity':
            return new RecentActivityRule(config as RecentActivityRuleJSONConfig);
        case 'repeatSubmission':
            return new RepeatSubmissionRule(config as RepeatSubmissionJSONConfig);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
