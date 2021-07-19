import {Rule, RuleJSONConfig, RuleOptions, RulePremise, RuleResult} from "./index";
import {Comment, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {
    activityWindowText,
    comparisonTextOp, FAIL, formatNumber,
    parseGenericValueOrPercentComparison, parseSubredditName,
    parseUsableLinkIdentifier,
    PASS
} from "../util";
import {
    ActivityWindow,
    ActivityWindowCriteria,
    ActivityWindowType,
    ReferenceSubmission,
    SubredditCriteria
} from "../Common/interfaces";



export class RegexRule extends Rule {
    constructor(options: RegexRuleOptions) {
        super(options);
        const {
        } = options || {};
    }

    getKind(): string {
        return 'Recent';
    }

    getSpecificPremise(): object {
        return {
        }
    }

    async process(item: Submission | Comment): Promise<[boolean, RuleResult]> {
        return Promise.resolve([false, this.getResult(false, {})]);
    }
}

interface RegexConfig {

}

export interface RegexRuleOptions extends RegexConfig, RuleOptions {
}

/**
 * Checks a user's history for any Activity (Submission/Comment) in the subreddits specified in thresholds
 *
 * Available data for [Action templating](https://github.com/FoxxMD/reddit-context-bot#action-templating):
 *
 * ```
 * summary    => comma-deliminated list of subreddits that hit the threshold and their count EX subredditA(1), subredditB(4),...
 * subCount   => Total number of subreddits that hit the threshold
 * totalCount => Total number of all activity occurrences in subreddits
 * ```
 * */
export interface RegexuleJSONConfig extends RegexConfig, RuleJSONConfig {
    /**
     * @examples ["regex"]
     * */
    kind: 'regex'
}

export default RegexRule;
