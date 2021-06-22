
import {ActivityWindowType, CompareValueOrPercent, ThresholdCriteria} from "../Common/interfaces";
import {Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import Submission from "snoowrap/dist/objects/Submission";
import {getAuthorActivities} from "../Utils/SnoowrapUtils";
import dayjs from "dayjs";
import {
    comparisonTextOp,
    FAIL,
    formatNumber,
    parseGenericValueOrPercentComparison,
    PASS,
    percentFromString
} from "../util";

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
 * If both `submission` and `comment` are defined then criteria will only trigger if BOTH thresholds are met
 * */
export interface HistoryCriteria {

    /**
     * A string containing a comparison operator and a value to compare submissions against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 100`  => greater than 100 submissions
     * * EX `<= 75%` => submissions are equal to or less than 75% of all Activities
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    submission?: CompareValueOrPercent
    /**
     * A string containing a comparison operator and a value to compare comments against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign] [OP]`
     *
     * * EX `> 100`  => greater than 100 comments
     * * EX `<= 75%` => comments are equal to or less than 75% of all Activities
     *
     * If your string also contains the text `OP` somewhere **after** `<number>[percent sign]`...:
     *
     * * EX `> 100 OP`  => greater than 100 comments as OP
     * * EX `<= 25% as OP` => Comments as OP were less then or equal to 25% of **all Comments**
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    comment?: CompareValueOrPercent

    window: ActivityWindowType

    /**
     * The minimum number of activities that must exist from the `window` results for this criteria to run
     * @default 5
     * */
    minActivityCount?: number
    name?: string
}

export class HistoryRule extends Rule {
    criteria: HistoryCriteria[];
    condition: 'AND' | 'OR';
    include: string[];
    exclude: string[];

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
        this.include = include.map(x => x.toLowerCase());
        this.exclude = exclude.map(x => x.toLowerCase());
    }

    getKind(): string {
        return "History";
    }

    protected getSpecificPremise(): object {
        return {
            criteria: this.criteria,
            include: this.include,
            exclude: this.exclude,
        }
    }

    protected async process(item: Submission): Promise<[boolean, RuleResult]> {
        // TODO reuse activities between ActivityCriteria to reduce api calls

        let criteriaResults = [];

        for (const criteria of this.criteria) {

            const {comment, window, submission, minActivityCount = 5} = criteria;

            let activities = await this.resources.getAuthorActivities(item.author, {window: window});
            activities = activities.filter(act => {
                if (this.include.length > 0) {
                    return this.include.some(x => x === act.subreddit.display_name.toLowerCase());
                } else if (this.exclude.length > 0) {
                    return !this.exclude.some(x => x === act.subreddit.display_name.toLowerCase())
                }
                return true;
            });

            if (activities.length < minActivityCount) {
                continue;
            }

            const activityTotal = activities.length;
            const {submissionTotal, commentTotal, opTotal} = activities.reduce((acc, act) => {
                if(act instanceof Submission) {
                    return {...acc, submissionTotal: acc.submissionTotal + 1};
                }
                let a = {...acc, commentTotal: acc.commentTotal + 1};
                if(act.is_submitter) {
                    a.opTotal = a.opTotal + 1;
                }
                return a;
            },{submissionTotal: 0, commentTotal: 0, opTotal: 0});

            let commentTrigger = undefined;
            if(comment !== undefined) {
                const {operator, value, isPercent, extra = ''} = parseGenericValueOrPercentComparison(comment);
                const asOp = extra.toLowerCase().includes('op');
                if(isPercent) {
                    const per = value / 100;
                    if(asOp) {
                        commentTrigger = comparisonTextOp(opTotal / commentTotal, operator, per);
                    } else {
                        commentTrigger = comparisonTextOp(commentTotal / activityTotal, operator, per);
                    }
                } else {
                    if(asOp) {
                        commentTrigger = comparisonTextOp(opTotal, operator, value);
                    } else {
                        commentTrigger = comparisonTextOp(commentTotal, operator, value);
                    }
                }
            }

            let submissionTrigger = undefined;
            if(submission !== undefined) {
                const {operator, value, isPercent} = parseGenericValueOrPercentComparison(submission);
                if(isPercent) {
                    const per = value / 100;
                    submissionTrigger = comparisonTextOp(submissionTotal / activityTotal, operator, per);
                } else {
                    submissionTrigger = comparisonTextOp(submissionTotal, operator, value);
                }
            }

            const firstActivity = activities[0];
            const lastActivity = activities[activities.length - 1];

            const activityTotalWindow = dayjs.duration(dayjs(firstActivity.created_utc * 1000).diff(dayjs(lastActivity.created_utc * 1000)));

            criteriaResults.push({
                criteria,
                activityTotal,
                activityTotalWindow,
                submissionTotal,
                commentTotal,
                opTotal,
                submissionTrigger,
                commentTrigger,
                triggered: (submissionTrigger === undefined || submissionTrigger === true) && (commentTrigger === undefined || commentTrigger === true)
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
            opTotal,
            criteria: {
                comment,
                submission,
                window,
            },
            criteria,
            triggered,
            submissionTrigger,
            commentTrigger,
        } = results;

        const data: any = {
            activityTotal,
            submissionTotal,
            commentTotal,
            opTotal,
            commentPercent: formatNumber((commentTotal/activityTotal)*100),
            submissionPercent: formatNumber((submissionTotal/activityTotal)*100),
            opPercent: formatNumber((opTotal/commentTotal)*100),
            criteria,
            window: typeof window === 'number' ? `${activityTotal} Items` : activityTotalWindow.humanize(true),
            triggered,
            submissionTrigger,
            commentTrigger,
        };

        let thresholdSummary = [];
        let submissionSummary;
        let commentSummary;
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
     * Only include Submissions from this list of Subreddits.
     *
     * A list of subreddits (case-insensitive) to look for. Do not include "r/" prefix.
     *
     * EX to match against /r/mealtimevideos and /r/askscience use ["mealtimevideos","askscience"]
     * @examples ["mealtimevideos","askscience"]
     * @minItems 1
     * */
    include?: string[],
    /**
     * Do not include Submissions from this list of Subreddits.
     *
     * A list of subreddits (case-insensitive) to look for. Do not include "r/" prefix.
     *
     * EX to match against /r/mealtimevideos and /r/askscience use ["mealtimevideos","askscience"]
     * @examples ["mealtimevideos","askscience"]
     * @minItems 1
     * */
    exclude?: string[],
}

export interface HistoryOptions extends HistoryConfig, RuleOptions {

}

/**
 * Aggregates an Author's submission and comment history. Rule can be triggered on count/percent of total (for either or both comment/sub totals) as well as comment OP total.
 *
 * Available data for [Action templating](https://github.com/FoxxMD/reddit-context-bot#action-templating):
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
