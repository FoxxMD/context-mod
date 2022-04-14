
import {
    ActivityWindowType,
    CompareValueOrPercent,
    RuleResult,
    SubredditState,
    ThresholdCriteria
} from "../Common/interfaces";
import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import Submission from "snoowrap/dist/objects/Submission";
import {getAuthorActivities} from "../Utils/SnoowrapUtils";
import dayjs from "dayjs";
import {
    asSubmission,
    comparisonTextOp,
    FAIL,
    formatNumber, getActivitySubredditName, isSubmission,
    parseGenericValueOrPercentComparison, parseSubredditName,
    PASS,
    percentFromString, toStrongSubredditState
} from "../util";
import {Comment, RedditUser} from "snoowrap";

export interface CommentThresholdCriteria extends ThresholdCriteria {
    /**
     * If `true` then when threshold...
     *
     * * is `number` it will be number of comments where author is OP
     * * is `percent` it will be **percent of total comments where author is OP**
     * */
    asOp?: boolean
}
/**
 * Criteria will only trigger if ALL present thresholds (comment, submission, total) are met
 * */
export interface HistoryCriteria {

    /**
     * A string containing a comparison operator and a value to compare **filtered** (using `include` or `exclude`, if present) submissions against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 100`  => greater than 100 filtered submissions
     * * EX `<= 75%` => filtered submissions are equal to or less than 75% of unfiltered Activities
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    submission?: CompareValueOrPercent
    /**
     * A string containing a comparison operator and a value to compare **filtered** (using `include` or `exclude`, if present) comments against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign] [OP]`
     *
     * * EX `> 100`  => greater than 100 comments
     * * EX `<= 75%` => comments are equal to or less than 75% of unfiltered Activities
     *
     * If your string also contains the text `OP` somewhere **after** `<number>[percent sign]`...:
     *
     * * EX `> 100 OP`  => greater than 100 filtered comments as OP
     * * EX `<= 25% as OP` => **Filtered** comments as OP were less then or equal to 25% of **unfiltered Comments**
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    comment?: CompareValueOrPercent

    /**
     * A string containing a comparison operator and a value to compare **filtered** (using `include` or `exclude`) activities against
     *
     * **Note:** This is only useful if using `include` or `exclude` otherwise percent will always be 100% and total === activityTotal
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign] [OP]`
     *
     * * EX `> 100`  => greater than 100 filtered activities
     * * EX `<= 75%` => filtered activities are equal to or less than 75% of all Activities
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    total?: CompareValueOrPercent

    window: ActivityWindowType

    /**
     * The minimum number of **filtered** activities that must exist from the `window` results for this criteria to run
     * @default 5
     * */
    minActivityCount?: number
    name?: string
}

export class HistoryRule extends Rule {
    criteria: HistoryCriteria[];
    condition: 'AND' | 'OR';
    include: (string | SubredditState)[];
    exclude: (string | SubredditState)[];
    activityFilterFunc: (x: Submission|Comment, author: RedditUser) => Promise<boolean> = async (x) => true;

    constructor(options: HistoryOptions) {
        super(options);
        const {
            criteria,
            condition = 'OR',
            include = [],
            exclude = [],
        } = options || {};

        this.criteria = criteria;
        this.condition = condition;
        if (this.criteria.length === 0) {
            throw new Error('Must provide at least one HistoryCriteria');
        }

        this.include = include;
        this.exclude = exclude;

        if(this.include.length > 0) {
            const subStates = include.map((x) => {
                if(typeof x === 'string') {
                    return toStrongSubredditState({name: x, stateDescription: x}, {defaultFlags: 'i', generateDescription: true});
                }
                return toStrongSubredditState(x, {defaultFlags: 'i', generateDescription: true});
            });
            this.activityFilterFunc = async (x: Submission|Comment, author: RedditUser) => {
                for(const ss of subStates) {
                    if(await this.resources.testSubredditCriteria(x, ss, author)) {
                        return true;
                    }
                }
                return false;
            };
        } else if(this.exclude.length > 0) {
            const subStates = exclude.map((x) => {
                if(typeof x === 'string') {
                    return toStrongSubredditState({name: x, stateDescription: x}, {defaultFlags: 'i', generateDescription: true});
                }
                return toStrongSubredditState(x, {defaultFlags: 'i', generateDescription: true});
            });
            this.activityFilterFunc = async (x: Submission|Comment, author: RedditUser) => {
                for(const ss of subStates) {
                    if(await this.resources.testSubredditCriteria(x, ss, author)) {
                        return false;
                    }
                }
                return true;
            };
        }
    }

    getKind(): string {
        return "history";
    }

    protected getSpecificPremise(): object {
        return {
            criteria: this.criteria,
            include: this.include,
            exclude: this.exclude,
        }
    }

    protected async process(item: Submission): Promise<[boolean, RuleResult]> {

        let criteriaResults = [];

        for (const criteria of this.criteria) {

            const {comment, window, submission, total, minActivityCount = 5} = criteria;

            let activities = await this.resources.getAuthorActivities(item.author, {window: window});
            const filteredActivities = [];
            for(const a of activities) {
                if(await this.activityFilterFunc(a, item.author)) {
                    filteredActivities.push(a);
                }
            }

            if (filteredActivities.length < minActivityCount) {
                continue;
            }

            const activityTotal = activities.length;
            const {submissionTotal, commentTotal, opTotal} = activities.reduce((acc, act) => {
                if(asSubmission(act)) {
                    return {...acc, submissionTotal: acc.submissionTotal + 1};
                }
                let a = {...acc, commentTotal: acc.commentTotal + 1};
                if(act.is_submitter) {
                    a.opTotal = a.opTotal + 1;
                }
                return a;
            },{submissionTotal: 0, commentTotal: 0, opTotal: 0});
            let fSubmissionTotal = submissionTotal;
            let fCommentTotal = commentTotal;
            let fOpTotal = opTotal;
            if(activities.length !== filteredActivities.length) {
                const filteredCounts = filteredActivities.reduce((acc, act) => {
                    if(asSubmission(act)) {
                        return {...acc, submissionTotal: acc.submissionTotal + 1};
                    }
                    let a = {...acc, commentTotal: acc.commentTotal + 1};
                    if(act.is_submitter) {
                        a.opTotal = a.opTotal + 1;
                    }
                    return a;
                },{submissionTotal: 0, commentTotal: 0, opTotal: 0});
                fSubmissionTotal = filteredCounts.submissionTotal;
                fCommentTotal = filteredCounts.commentTotal;
                fOpTotal = filteredCounts.opTotal;
            }

            let commentTrigger = undefined;
            if(comment !== undefined) {
                const {operator, value, isPercent, extra = ''} = parseGenericValueOrPercentComparison(comment);
                const asOp = extra.toLowerCase().includes('op');
                if(isPercent) {
                    const per = value / 100;
                    if(asOp) {
                        commentTrigger = comparisonTextOp(fOpTotal / commentTotal, operator, per);
                    } else {
                        commentTrigger = comparisonTextOp(fCommentTotal / activityTotal, operator, per);
                    }
                } else {
                    if(asOp) {
                        commentTrigger = comparisonTextOp(fOpTotal, operator, value);
                    } else {
                        commentTrigger = comparisonTextOp(fCommentTotal, operator, value);
                    }
                }
            }

            let submissionTrigger = undefined;
            if(submission !== undefined) {
                const {operator, value, isPercent} = parseGenericValueOrPercentComparison(submission);
                if(isPercent) {
                    const per = value / 100;
                    submissionTrigger = comparisonTextOp(fSubmissionTotal / activityTotal, operator, per);
                } else {
                    submissionTrigger = comparisonTextOp(fSubmissionTotal, operator, value);
                }
            }

            let totalTrigger = undefined;
            if(total !== undefined) {
                const {operator, value, isPercent} = parseGenericValueOrPercentComparison(total);
                if(isPercent) {
                    const per = value / 100;
                    totalTrigger = comparisonTextOp(filteredActivities.length / activityTotal, operator, per);
                } else {
                    totalTrigger = comparisonTextOp(filteredActivities.length, operator, value);
                }
            }

            const firstActivity = activities[0];
            const lastActivity = activities[activities.length - 1];

            const activityTotalWindow = activities.length === 0 ? dayjs.duration(0, 's') : dayjs.duration(dayjs(firstActivity.created_utc * 1000).diff(dayjs(lastActivity.created_utc * 1000)));

            criteriaResults.push({
                criteria,
                activityTotal,
                activityTotalWindow,
                submissionTotal: fSubmissionTotal,
                commentTotal: fCommentTotal,
                opTotal: fOpTotal,
                filteredTotal: filteredActivities.length,
                submissionTrigger,
                commentTrigger,
                totalTrigger,
                triggered: (submissionTrigger === undefined || submissionTrigger === true) && (commentTrigger === undefined || commentTrigger === true) && (totalTrigger === undefined || totalTrigger === true)
            });
        }

        let criteriaMet = false;
        let failCriteriaResult: string = '';
        if (this.condition === 'OR') {
            criteriaMet = criteriaResults.some(x => x.triggered);
            if(!criteriaMet) {
                failCriteriaResult = `${FAIL} No criteria was met`;
            }
        } else {
            criteriaMet = criteriaResults.every(x => x.triggered);
            if(!criteriaMet) {
                if(criteriaResults.some(x => x.triggered)) {
                    const met = criteriaResults.filter(x => x.triggered);
                    failCriteriaResult = `${FAIL} ${met.length} out of ${criteriaResults.length} criteria met but Rule required all be met. Set log level to debug to see individual results`;
                    const results = criteriaResults.map(x => this.generateResultDataFromCriteria(x, true));
                    this.logger.debug(`\r\n ${results.map(x => x.result).join('\r\n')}`);
                } else {
                    failCriteriaResult = `${FAIL} No criteria was met`;
                }
            }
        }

        if(criteriaMet) {
            // use first triggered criteria found
            const refCriteriaResults = criteriaResults.find(x => x.triggered);
            const resultData = this.generateResultDataFromCriteria(refCriteriaResults);

            this.logger.verbose(`${PASS} ${resultData.result}`);
            return Promise.resolve([true, this.getResult(true, resultData)]);
        }

        return Promise.resolve([false, this.getResult(false, {result: failCriteriaResult})]);
    }

    protected generateResultDataFromCriteria(results: any, includePassFailSymbols = false) {
        const {
            activityTotal,
            activityTotalWindow,
            submissionTotal,
            commentTotal,
            filteredTotal,
            opTotal,
            criteria: {
                comment,
                submission,
                total,
                window,
            },
            criteria,
            triggered,
            submissionTrigger,
            commentTrigger,
            totalTrigger,
        } = results;

        const data: any = {
            activityTotal,
            submissionTotal,
            commentTotal,
            filteredTotal,
            opTotal,
            commentPercent: formatNumber((commentTotal/activityTotal)*100),
            submissionPercent: formatNumber((submissionTotal/activityTotal)*100),
            opPercent: formatNumber((opTotal/commentTotal)*100),
            filteredPercent: formatNumber((filteredTotal/activityTotal)*100),
            criteria,
            window: typeof window === 'number' || activityTotal === 0 ? `${activityTotal} Items` : activityTotalWindow.humanize(true),
            triggered,
            submissionTrigger,
            commentTrigger,
            totalTrigger,
        };

        let thresholdSummary = [];
        let totalSummary;
        let submissionSummary;
        let commentSummary;
        if(total !== undefined) {
            const {operator, value, isPercent, displayText} = parseGenericValueOrPercentComparison(total);
            const suffix = !isPercent ? 'Items' : `(${formatNumber((filteredTotal/activityTotal)*100)}%) of ${activityTotal} Total`;
            totalSummary = `${includePassFailSymbols ? `${submissionTrigger ? PASS : FAIL} ` : ''}Filtered Activities (${filteredTotal}) were${totalTrigger ? '' : ' not'} ${displayText} ${suffix}`;
            data.totalSummary = totalSummary;
            thresholdSummary.push(totalSummary);
        }
        if(submission !== undefined) {
            const {operator, value, isPercent, displayText} = parseGenericValueOrPercentComparison(submission);
            const suffix = !isPercent ? 'Items' : `(${formatNumber((submissionTotal/activityTotal)*100)}%) of ${activityTotal} Total`;
            submissionSummary = `${includePassFailSymbols ? `${submissionTrigger ? PASS : FAIL} ` : ''}Submissions (${submissionTotal}) were${submissionTrigger ? '' : ' not'} ${displayText} ${suffix}`;
            data.submissionSummary = submissionSummary;
            thresholdSummary.push(submissionSummary);
        }
        if(comment !== undefined) {
            const {operator, value, isPercent, displayText, extra = ''} = parseGenericValueOrPercentComparison(comment);
            const asOp = extra.toLowerCase().includes('op');
            const totalType = asOp ? 'Comments' : 'Activities'
            const countType = asOp ? 'Comments as OP' : 'Comments';
            const suffix = !isPercent ? 'Items' : `(${asOp ? formatNumber((opTotal/commentTotal)*100) : formatNumber((commentTotal/activityTotal)*100)}%) of ${activityTotal} Total ${totalType}`;
            commentSummary = `${includePassFailSymbols ? `${commentTrigger ? PASS : FAIL} ` : ''}${countType} (${asOp ? opTotal : commentTotal}) were${commentTrigger ? '' : ' not'} ${displayText} ${suffix}`;
            data.commentSummary = commentSummary;
            thresholdSummary.push(commentSummary);
        }

        data.thresholdSummary = thresholdSummary.join(' and ');

        const result = `${thresholdSummary} (${data.window})`;

        return {result, data};
    }

}

export default HistoryRule;

interface HistoryConfig  {

    /**
     * A list threshold-window values to test activities against.
     *
     * @minItems 1
     * */
    criteria: HistoryCriteria[]

    /**
     * * If `OR` then any set of Criteria that pass will trigger the Rule
     * * If `AND` then all Criteria sets must pass to trigger the Rule
     * */
    condition?: 'AND' | 'OR'

    /**
     * If present, activities will be counted only if they are found in this list of Subreddits.
     *
     * Each value in the list can be either:
     *
     *  * string (name of subreddit)
     *  * regular expression to run on the subreddit name
     *  * `SubredditState`
     *
     * EX `["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]`
     *
     *  **Note:** This affects **post-window retrieval** activities. So that:
     *
     * * `activityTotal` is number of activities retrieved from `window` -- NOT post-filtering
     * * all comparisons using **percentages** will compare **post-filtering** results against **activity count from window**
     * * -- to run this rule where all activities are only from include/exclude filtering instead use include/exclude in `window`
     *
     * @examples [["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]]
     * */
    include?: (string | SubredditState)[],
    /**
     * If present, activities will be counted only if they are **NOT** found in this list of Subreddits
     *
     * Each value in the list can be either:
     *
     *  * string (name of subreddit)
     *  * regular expression to run on the subreddit name
     *  * `SubredditState`
     *
     * EX `["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]`
     *
     * **Note:** This affects **post-window retrieval** activities. So that:
     *
     * * `activityTotal` is number of activities retrieved from `window` -- NOT post-filtering
     * * all comparisons using **percentages** will compare **post-filtering** results against **activity count from window**
     * * -- to run this rule where all activities are only from include/exclude filtering instead use include/exclude in `window`
     *
     * @examples [["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]]
     * */
    exclude?: (string | SubredditState)[],
}

export interface HistoryOptions extends HistoryConfig, RuleOptions {

}

/**
 * Aggregates an Author's submission and comment history. Rule can be triggered on count/percent of total (for either or both comment/sub totals) as well as comment OP total.
 *
 * Available data for [Action templating](https://github.com/FoxxMD/context-mod#action-templating):
 *
 * ```
 * activityTotal    => Total number of activities
 * submissionTotal  => Total number of submissions
 * commentTotal     => Total number of comments
 * opTotal          => Total number of comments as OP
 * thresholdSummary => A text summary of the first Criteria triggered with totals/percentages
 * criteria         => The ThresholdCriteria object
 * window           => A text summary of the range of Activities considered (# of Items if number, time range if Duration)
 * ```
 * */
export interface HistoryJSONConfig extends HistoryConfig, RuleJSONConfig {
    kind: 'history'
}
