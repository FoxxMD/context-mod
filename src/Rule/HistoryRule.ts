
import {ActivityWindowType, ThresholdCriteria} from "../Common/interfaces";
import {Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import Submission from "snoowrap/dist/objects/Submission";
import {getAuthorActivities} from "../Utils/SnoowrapUtils";
import dayjs from "dayjs";
import {comparisonTextOp, formatNumber, percentFromString} from "../util";

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

    submission?: ThresholdCriteria
    comment?: CommentThresholdCriteria
    /**
     * Window defining Activities to consider (both Comment/Submission)
     */
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
    criteriaJoin: 'AND' | 'OR';
    include: string[];
    exclude: string[];

    constructor(options: HistoryOptions) {
        super(options);
        const {
            criteria,
            criteriaJoin = 'OR',
            include = [],
            exclude = [],
        } = options || {};

        this.criteria = criteria;
        this.criteriaJoin = criteriaJoin;
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

    protected async process(item: Submission): Promise<[boolean, RuleResult[]]> {
        // TODO reuse activities between ActivityCriteria to reduce api calls

        let criteriaResults = [];

        for (const criteria of this.criteria) {

            const {comment, window, submission, minActivityCount = 5} = criteria;

            let activities = await getAuthorActivities(item.author, {window: window});
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
                const {threshold, condition, asOp = false} = comment;
                if(typeof threshold === 'string') {
                    const per = percentFromString(threshold);
                    if(asOp) {
                        commentTrigger = comparisonTextOp(opTotal / commentTotal, condition, per);
                    } else {
                        commentTrigger = comparisonTextOp(commentTotal / activityTotal, condition, per);
                    }
                } else {
                    if(asOp) {
                        commentTrigger = comparisonTextOp(opTotal, condition, threshold);
                    } else {
                        commentTrigger = comparisonTextOp(commentTotal, condition, threshold);
                    }
                }
            }

            let submissionTrigger = undefined;
            if(submission !== undefined) {
                const {threshold, condition, } = submission;
                if(typeof threshold === 'string') {
                    const per = percentFromString(threshold);
                    submissionTrigger = comparisonTextOp(submissionTotal / activityTotal, condition, per);
                } else {
                    submissionTrigger = comparisonTextOp(submissionTotal, condition, threshold);
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
                triggered: submissionTrigger === true || commentTrigger === true
            });
        }

        let criteriaMeta = false;
        if (this.criteriaJoin === 'OR') {
            criteriaMeta = criteriaResults.some(x => x.triggered);
        } else {
            criteriaMeta = criteriaResults.every(x => x.triggered);
        }

        if (criteriaMeta) {
            // use first triggered criteria found
            const refCriteriaResults = criteriaResults.find(x => x.triggered);
            if (refCriteriaResults !== undefined) {
                const {
                    activityTotal,
                    activityTotalWindow,
                    submissionTotal,
                    commentTotal,
                    opTotal,
                    criteria: {
                        comment: {
                            threshold: cthresh,
                            condition: ccond,
                            asOp
                        } = {},
                        submission: {
                            threshold: sthresh,
                            condition: scond,
                        } = {},
                        window,
                    },
                    criteria,
                } = refCriteriaResults;

                let thresholdSummary = [];
                let submissionSummary;
                let commentSummary;
                if(sthresh !== undefined) {
                    const suffix = typeof sthresh === 'number' ? 'Items' : `(${formatNumber((submissionTotal/activityTotal)*100)}%) of Total (${activityTotal})`;
                    submissionSummary = `Submissions (${submissionTotal}) were ${scond}${sthresh} ${suffix}`;
                    thresholdSummary.push(submissionSummary);
                }
                if(cthresh !== undefined) {
                    const totalType = asOp ? 'Comments' : 'Activities'
                    const countType = asOp ? 'Comments as OP' : 'Comments';
                    const suffix = typeof cthresh === 'number' ? 'Items' : `(${asOp ? formatNumber((opTotal/commentTotal)*100) : formatNumber((commentTotal/activityTotal)*100)}%) of Total ${totalType} (${activityTotal})`;
                    commentSummary = `${countType} (${asOp ? opTotal : commentTotal}) were ${ccond}${cthresh} ${suffix}`;
                    thresholdSummary.push(commentSummary);
                }

                const data: any = {
                    activityTotal,
                    submissionTotal,
                    commentTotal,
                    opTotal,
                    submissionSummary,
                    commentSummary,
                    thresholdSummary: thresholdSummary.join(' and '),
                    criteria,
                    window: typeof window === 'number' ? `${activityTotal} Items` : activityTotalWindow.humanize(true)

                };

                const result = `${thresholdSummary} (${data.window})`;

                return Promise.resolve([true, [this.getResult(true, {
                    result,
                    data,
                })]]);
            }

        }

        return Promise.resolve([false, [this.getResult(false)]]);
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
    criteriaJoin?: 'AND' | 'OR'

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
