import {Rule, RuleJSONConfig, RuleOptions, RulePremise, RuleResult} from "./index";
import {Comment, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {
    activityWindowText, asSubmission,
    comparisonTextOp, FAIL, formatNumber, getActivitySubredditName, isSubmission,
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

const parseLink = parseUsableLinkIdentifier();

export class RecentActivityRule extends Rule {
    window: ActivityWindowType;
    thresholds: SubThreshold[];
    useSubmissionAsReference: boolean;
    lookAt?: 'comments' | 'submissions';

    constructor(options: RecentActivityRuleOptions) {
        super(options);
        const {
            window = 15,
            useSubmissionAsReference = true,
            lookAt,
        } = options || {};
        this.lookAt = lookAt;
        this.useSubmissionAsReference = useSubmissionAsReference;
        this.window = window;
        this.thresholds = options.thresholds;
    }

    getKind(): string {
        return 'Recent';
    }

    getSpecificPremise(): object {
        return {
            window: this.window,
            thresholds: this.thresholds,
            useSubmissionAsReference: this.useSubmissionAsReference,
            lookAt: this.lookAt
        }
    }

    async process(item: Submission | Comment): Promise<[boolean, RuleResult]> {
        let activities;

        switch (this.lookAt) {
            case 'comments':
                activities = await this.resources.getAuthorComments(item.author, {window: this.window});
                break;
            case 'submissions':
                activities = await this.resources.getAuthorSubmissions(item.author, {window: this.window});
                break;
            default:
                activities = await this.resources.getAuthorActivities(item.author, {window: this.window});
                break;
        }

        let viableActivity = activities;
        if (this.useSubmissionAsReference) {
            if (!asSubmission(item)) {
                this.logger.warn('Cannot use post as reference because triggered item is not a Submission');
            } else if (item.is_self) {
                this.logger.warn('Cannot use post as reference because triggered Submission is not a link type');
            } else {
                const usableUrl = parseLink(await item.url);
                viableActivity = viableActivity.filter((x) => {
                    if (!asSubmission(x)) {
                        return false;
                    }
                    if (x.url === undefined) {
                        return false;
                    }
                    return parseLink(x.url) === usableUrl;
                });
            }
        }
        const groupedActivity = viableActivity.reduce((grouped, activity) => {
            const s = getActivitySubredditName(activity).toLowerCase();
            grouped[s] = (grouped[s] || []).concat(activity);
            return grouped;
        }, {} as Record<string, (Submission | Comment)[]>);


        const summaries = [];
        let totalTriggeredOn;
        for (const triggerSet of this.thresholds) {
            let currCount = 0;
            const presentSubs = [];
            const {threshold = '>= 1', subreddits = []} = triggerSet;
            for (const sub of subreddits.map(x => parseSubredditName(x))) {
                const isub = sub.toLowerCase();
                const {[isub]: tSub = []} = groupedActivity;
                if (tSub.length > 0) {
                    currCount += tSub.length;
                    presentSubs.push(sub);
                }
            }
            const {operator, value, isPercent} = parseGenericValueOrPercentComparison(threshold);
            let sum = {subsWithActivity: presentSubs, subreddits, count: currCount, threshold, triggered: false, testValue: currCount.toString()};
            if (isPercent) {
                sum.testValue = `${formatNumber((currCount / viableActivity.length) * 100)}%`;
                if (comparisonTextOp(currCount / viableActivity.length, operator, value / 100)) {
                    sum.triggered = true;
                    totalTriggeredOn = sum;
                }
            } else if (comparisonTextOp(currCount, operator, value)) {
                sum.triggered = true;
                totalTriggeredOn = sum;
            }
            summaries.push(sum);
            // if either trigger condition is hit end the iteration early
            if (totalTriggeredOn !== undefined) {
                break;
            }
        }
        let result = '';
        if (totalTriggeredOn !== undefined) {
            const resultData = this.generateResultData(totalTriggeredOn, viableActivity);
            result = `${PASS} ${resultData.result}`;
            this.logger.verbose(result);
            return Promise.resolve([true, this.getResult(true, resultData)]);
        } else if(summaries.length === 1) {
            // can display result if its only one summary otherwise need to log to debug
            const res = this.generateResultData(summaries[0], viableActivity);
            result = `${FAIL} ${res.result}`;
        } else {
            result = `${FAIL} No criteria was met. Use 'debug' to see individual results`;
            this.logger.debug(`\r\n ${summaries.map(x => this.generateResultData(x, viableActivity).result).join('\r\n')}`);
        }

        this.logger.verbose(result);

        return Promise.resolve([false, this.getResult(false, {result})]);
    }
    
    generateResultData(summary: any, activities: (Submission | Comment)[] = []) {
        const {
            count,
            testValue,
            subreddits = [],
            subsWithActivity = [],
            threshold,
            triggered
        } = summary;
        const relevantSubs = subsWithActivity.length === 0 ? subreddits : subsWithActivity;
        const totalSummary = `${testValue} activities over ${relevantSubs.length} subreddits ${triggered ? 'met' : 'did not meet'} threshold of ${threshold}`;
        return {
            result: totalSummary,
            data: {
                window: typeof this.window === 'number' ? `${activities.length} Items` : activityWindowText(activities),
                summary: totalSummary,
                subSummary: relevantSubs.join(', '),
                subCount: relevantSubs.length,
                totalCount: count,
                threshold,
                testValue
            }
        };
    }
}

/**
 * At least one count property must be present. If both are present then either can trigger the rule
 *
 * @minProperties 1
 * @additionalProperties false
 * */
export interface SubThreshold extends SubredditCriteria {
    /**
     * A string containing a comparison operator and a value to compare recent activities against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 3`  => greater than 3 activities found in the listed subreddits
     * * EX `<= 75%` => number of Activities in the subreddits listed are equal to or less than 75% of all Activities
     *
     * **Note:** If you use percentage comparison here as well as `useSubmissionAsReference` then "all Activities" is only pertains to Activities that had the Link of the Submission, rather than all Activities from this window.
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @default ">= 1"
     * @examples [">= 1"]
     * */
    threshold?: string
}

interface RecentActivityConfig extends ActivityWindow, ReferenceSubmission {
    /**
     * If present restricts the activities that are considered for count from SubThreshold
     * @examples ["submissions","comments"]
     * */
    lookAt?: 'comments' | 'submissions',
    /**
     * A list of subreddits/count criteria that may trigger this rule. ANY SubThreshold will trigger this rule.
     * @minItems 1
     * */
    thresholds: SubThreshold[],
}

export interface RecentActivityRuleOptions extends RecentActivityConfig, RuleOptions {
}

/**
 * Checks a user's history for any Activity (Submission/Comment) in the subreddits specified in thresholds
 *
 * Available data for [Action templating](https://github.com/FoxxMD/context-mod#action-templating):
 *
 * ```
 * summary    => comma-deliminated list of subreddits that hit the threshold and their count EX subredditA(1), subredditB(4),...
 * subCount   => Total number of subreddits that hit the threshold
 * totalCount => Total number of all activity occurrences in subreddits
 * ```
 * */
export interface RecentActivityRuleJSONConfig extends RecentActivityConfig, RuleJSONConfig {
    /**
     * @examples ["recentActivity"]
     * */
    kind: 'recentActivity'
}

export default RecentActivityRule;
