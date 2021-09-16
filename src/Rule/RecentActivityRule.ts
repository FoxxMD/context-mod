import {Rule, RuleJSONConfig, RuleOptions, RulePremise, RuleResult} from "./index";
import {Comment, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {
    activityWindowText, asSubmission,
    comparisonTextOp, FAIL, formatNumber, getActivitySubredditName, isSubmission, objectToStringSummary,
    parseGenericValueOrPercentComparison, parseStringToRegex, parseSubredditName,
    parseUsableLinkIdentifier,
    PASS, toStrongSubredditState
} from "../util";
import {
    ActivityWindow,
    ActivityWindowCriteria,
    ActivityWindowType, CommentState,
    ReferenceSubmission, StrongSubredditState, SubmissionState,
    SubredditCriteria, SubredditState
} from "../Common/interfaces";
import {SubredditResources} from "../Subreddit/SubredditResources";

const parseLink = parseUsableLinkIdentifier();

export class RecentActivityRule extends Rule {
    window: ActivityWindowType;
    thresholds: ActivityThreshold[];
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

        const summaries = [];
        let totalTriggeredOn;
        for (const triggerSet of this.thresholds) {
            let currCount = 0;
            const presentSubs: string[] = [];
            let combinedKarma = 0;
            const {
                threshold = '>= 1',
                subreddits = [],
                karma: karmaThreshold,
                commentState,
                submissionState,
            } = triggerSet;

            // convert subreddits array into entirely StrongSubredditState
            const subStates: StrongSubredditState[] = subreddits.map((x) => {
                if(typeof x === 'string') {
                    return toStrongSubredditState({name: x, stateDescription: x}, {defaultFlags: 'i', generateDescription: true});
                }
                return toStrongSubredditState(x, {defaultFlags: 'i', generateDescription: true});
            });

            for(const activity of viableActivity) {
                if(asSubmission(activity) && submissionState !== undefined) {
                    if(!(await this.resources.testItemCriteria(activity, [submissionState]))) {
                        continue;
                    }
                } else if(commentState !== undefined) {
                    if(!(await this.resources.testItemCriteria(activity, [commentState]))) {
                        continue;
                    }
                }
                let inSubreddits = false;
                for(const ss of subStates) {
                    const res = await this.resources.testSubredditCriteria(activity, ss);
                    if(res) {
                        inSubreddits = true;
                        break;
                    }
                }
                if(inSubreddits) {
                    currCount++;
                    combinedKarma += activity.score;
                    const pSub = getActivitySubredditName(activity);
                    if(!presentSubs.includes(pSub)) {
                        presentSubs.push(pSub);
                    }
                }
            }

            const {operator, value, isPercent} = parseGenericValueOrPercentComparison(threshold);
            let sum = {subsWithActivity: presentSubs, combinedKarma, karmaThreshold, subreddits: subStates.map(x => x.stateDescription), count: currCount, threshold, triggered: false, testValue: currCount.toString()};
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
            // if we would trigger on threshold need to also test for karma
            if(totalTriggeredOn !== undefined && karmaThreshold !== undefined) {
                const {operator: opKarma, value: valueKarma} = parseGenericValueOrPercentComparison(karmaThreshold);
                if(!comparisonTextOp(combinedKarma, opKarma, valueKarma)) {
                    sum.triggered = false;
                    totalTriggeredOn = undefined;
                }
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
            triggered,
            combinedKarma,
            karmaThreshold,
        } = summary;
        const relevantSubs = subsWithActivity.length === 0 ? subreddits : subsWithActivity;
        let totalSummary = `${testValue} activities over ${relevantSubs.length} subreddits${karmaThreshold !== undefined ? ` with ${combinedKarma} combined karma` : ''} ${triggered ? 'met' : 'did not meet'} threshold of ${threshold}${karmaThreshold !== undefined ? ` and ${karmaThreshold} combined karma` : ''}`;
        if(triggered && subsWithActivity.length > 0) {
            totalSummary = `${totalSummary} -- subreddits: ${subsWithActivity.join(', ')}`;
        }
        return {
            result: totalSummary,
            data: {
                window: typeof this.window === 'number' ? `${activities.length} Items` : activityWindowText(activities),
                summary: totalSummary,
                subSummary: relevantSubs.join(', '),
                subCount: relevantSubs.length,
                totalCount: count,
                threshold,
                testValue,
                karmaThreshold,
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
export interface ActivityThreshold {
    /**
    * When present, a Submission will only be counted if it meets this criteria
    * */
    submissionState?: SubmissionState
    /**
    * When present, a Comment will only be counted if it meets this criteria
    * */
    commentState?: CommentState

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

    /**
     * Test the **combined karma** from Activities found in the specified subreddits
     *
     * Value is a string containing a comparison operator and a number of **combined karma** to compare against
     *
     * If specified then both `threshold` and `karma` must be met for this `SubThreshold` to be satisfied
     *
     * The syntax is `(< OR > OR <= OR >=) <number>`
     *
     * * EX `> 50`  => greater than 50 combined karma for all found Activities in specified subreddits
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    karma?: string

    /**
     * Activities will be counted if they are found in this list of Subreddits
     *
     * Each value in the list can be either:
     *
     *  * string (name of subreddit)
     *  * regular expression to run on the subreddit name
     *  * `SubredditState`
     *
     * EX `["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]`
     * @examples [["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]]
     * */
    subreddits?: (string | SubredditState)[]
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
    thresholds: ActivityThreshold[],
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
