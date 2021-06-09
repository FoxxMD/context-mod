import {SubmissionRule, SubmissionRuleJSONConfig} from "./index";
import {ActivityWindow, ActivityWindowType, ReferenceSubmission} from "../../Common/interfaces";
import {RuleOptions, RuleResult} from "../index";
import Submission from "snoowrap/dist/objects/Submission";
import {getAttributionIdentifier, getAuthorActivities, getAuthorSubmissions} from "../../Utils/SnoowrapUtils";
import dayjs from "dayjs";


export interface AttributionCriteria {
    /**
     * The number or percentage to trigger this rule at
     *
     * * If `threshold` is a `number` then it is the absolute number of attribution instances to trigger at
     * * If `threshold` is a `string` with percentage (EX `40%`) then it is the percentage of the total (see `lookAt`) this attribution must reach to trigger
     *
     * @default 10%
     * */
    threshold: number | string
    window: ActivityWindowType
    /**
     * What activities to use for total count when determining what percentage an attribution comprises
     *
     * EX:
     *
     * Author has 100 activities, 40 are submissions and 60 are comments
     *
     * * If `submission` then if 10 submission are for Youtube Channel A then percentage => 10/40 = 25%
     * * If `all` then if 10 submission are for Youtube Channel A then percentage => 10/100 = 10%
     *
     * @default all
     **/
    thresholdOn?: 'submissions' | 'all'
    /**
     * The minimum number of activities that must exist for this criteria to run
     * @default 5
     * */
    minActivityCount?: number
    name?: string
}

const defaultCriteria = [{threshold: '10%', window: 100}];

export class AttributionRule extends SubmissionRule {
    criteria: AttributionCriteria[];
    criteriaJoin: 'AND' | 'OR';
    useSubmissionAsReference: boolean;
    lookAt: 'media' | 'all' = 'media';
    include: string[];
    exclude: string[];
    aggregateMediaDomains: boolean = false;
    includeSelf: boolean = false;

    constructor(options: AttributionOptions) {
        super(options);
        const {
            criteria = defaultCriteria,
            criteriaJoin = 'OR',
            include = [],
            exclude = [],
            lookAt = 'media',
            aggregateMediaDomains = false,
            useSubmissionAsReference = true,
            includeSelf = false,
        } = options || {};

        this.criteria = criteria;
        this.criteriaJoin = criteriaJoin;
        if (this.criteria.length === 0) {
            throw new Error('Must provide at least one AttributionCriteria');
        }
        this.include = include.map(x => x.toLowerCase());
        this.exclude = exclude.map(x => x.toLowerCase());
        this.lookAt = lookAt;
        this.aggregateMediaDomains = aggregateMediaDomains;
        this.includeSelf = includeSelf;
        this.useSubmissionAsReference = useSubmissionAsReference;
    }

    getKind(): string {
        return "Attribution";
    }

    protected getSpecificPremise(): object {
        return {
            criteria: this.criteria,
            useSubmissionAsReference: this.useSubmissionAsReference,
            include: this.include,
            exclude: this.exclude,
            lookAt: this.lookAt,
            aggregateMediaDomains: this.aggregateMediaDomains,
            includeSelf: this.includeSelf,
        }
    }

    protected async process(item: Submission): Promise<[boolean, RuleResult[]]> {
        const referenceUrl = await item.url;
        if (referenceUrl === undefined && this.useSubmissionAsReference) {
            throw new Error(`Cannot run Rule ${this.name} because submission is not a link`);
        }

        const refDomain = this.aggregateMediaDomains ? item.domain : item.secure_media?.oembed?.author_url;
        const refDomainTitle = this.aggregateMediaDomains ? (item.secure_media?.oembed?.provider_name || item.domain) : item.secure_media?.oembed?.author_name;

        // TODO reuse activities between ActivityCriteria to reduce api calls

        let criteriaResults = [];

        for (const criteria of this.criteria) {

            const {threshold, window, thresholdOn = 'all', minActivityCount = 5} = criteria;

            let percentVal;
            if (typeof threshold === 'string') {
                percentVal = Number.parseInt(threshold.replace('%', '')) / 100;
            }

            let activities = thresholdOn === 'submissions' ? await getAuthorSubmissions(item.author, {window: window}) : await getAuthorActivities(item.author, {window: window});
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
            //const activities = await getAuthorSubmissions(item.author, {window: window}) as Submission[];

            const submissions: Submission[] = thresholdOn === 'submissions' ? activities as Submission[] : activities.filter(x => x instanceof Submission) as Submission[];
            const aggregatedSubmissions = submissions.reduce((acc: Map<string, number>, sub) => {
                if (this.lookAt === 'media' && sub.secure_media === undefined) {
                    return acc;
                }

                const domain = getAttributionIdentifier(sub, this.aggregateMediaDomains)

                if ((sub.is_self || sub.is_video || domain === 'i.redd.it') && !this.includeSelf) {
                    return acc;
                }

                const count = acc.get(domain) || 0;

                acc.set(domain, count + 1);

                return acc;
            }, new Map());

            let activityTotal = 0;
            let firstActivity, lastActivity;

            activityTotal = activities.length;
            firstActivity = activities[0];
            lastActivity = activities[activities.length - 1];

            // if (this.includeInTotal === 'submissions') {
            //     activityTotal = activities.length;
            //     firstActivity = activities[0];
            //     lastActivity = activities[activities.length - 1];
            // } else {
            //     const dur = typeof window === 'number' ? dayjs.duration(dayjs().diff(dayjs(activities[activities.length - 1].created * 1000))) : window;
            //     const allActivities = await getAuthorActivities(item.author, {window: dur});
            //     activityTotal = allActivities.length;
            //     firstActivity = allActivities[0];
            //     lastActivity = allActivities[allActivities.length - 1];
            // }

            const activityTotalWindow = dayjs.duration(dayjs(firstActivity.created_utc * 1000).diff(dayjs(lastActivity.created_utc * 1000)));

            let triggeredDomains = [];
            for (const [domain, subCount] of aggregatedSubmissions) {
                let triggered = false;
                if (percentVal !== undefined) {

                    triggered = percentVal <= subCount / activityTotal;
                } else if (subCount >= threshold) {
                    triggered = true;
                }

                if (triggered) {
                    // look for author channel
                    const withChannel = submissions.find(x => x.secure_media?.oembed?.author_url === domain || x.secure_media?.oembed?.author_name === domain);
                    triggeredDomains.push({
                        domain,
                        title: withChannel !== undefined ? (withChannel.secure_media?.oembed?.author_name || withChannel.secure_media?.oembed?.author_url) : domain,
                        count: subCount,
                        percent: Math.round((subCount / activityTotal) * 100)
                    });
                }
            }

            if (this.useSubmissionAsReference) {
                // filter triggeredDomains to only reference
                triggeredDomains = triggeredDomains.filter(x => x.domain === refDomain || x.domain === refDomainTitle);
            }

            criteriaResults.push({criteria, activityTotal, activityTotalWindow, triggeredDomains});
        }

        let criteriaMeta = false;
        if (this.criteriaJoin === 'OR') {
            criteriaMeta = criteriaResults.some(x => x.triggeredDomains.length > 0);
        } else {
            criteriaMeta = criteriaResults.every(x => x.triggeredDomains.length > 0);
        }

        if (criteriaMeta) {
            // use first triggered criteria found
            const refCriteriaResults = criteriaResults.find(x => x.triggeredDomains.length > 0);
            if (refCriteriaResults !== undefined) {
                const {
                    triggeredDomains,
                    activityTotal,
                    activityTotalWindow,
                    criteria: {threshold, window}
                } = refCriteriaResults;

                const largestCount = triggeredDomains.reduce((acc, curr) => Math.max(acc, curr.count), 0);
                const largestPercent = triggeredDomains.reduce((acc, curr) => Math.max(acc, curr.percent), 0);

                const data: any = {
                    triggeredDomainCount: triggeredDomains.length,
                    activityTotal,
                    largestCount,
                    largestPercent,
                    threshold: threshold,
                    window: typeof window === 'number' ? `${activityTotal} Items` : activityTotalWindow.humanize()

                };
                if (this.useSubmissionAsReference) {
                    data.refDomain = refDomain;
                    data.refDomainTitle = refDomainTitle;
                }

                const result = `${triggeredDomains.length} Attribution(s) met the threshold of ${threshold}, largest being ${largestCount} (${largestPercent}%) of ${activityTotal} Total -- window: ${data.window}`;

                return Promise.resolve([true, [this.getResult(true, {
                    result,
                    data,
                })]]);
            }

        }

        return Promise.resolve([false, [this.getResult(false)]]);
    }

}

interface AttributionConfig extends ReferenceSubmission {

    /**
     * A list threshold-window values to test attribution against
     *
     * If none is provided the default set used is:
     *
     * ```
     * threshold: 10%
     * window: 100
     * ```
     *
     * @minItems 1
     * */
    criteria?: AttributionCriteria[]

    /**
     * * If `OR` then any set of AttributionCriteria that produce an Attribution over the threshold will trigger the rule.
     * * If `AND` then all AttributionCriteria sets must product an Attribution over the threshold to trigger the rule.
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

    /**
     * Determines which type of attribution to look at
     *
     * * If `media` then only the author's submission history which reddit recognizes as media (youtube, vimeo, etc.) will be considered
     * * If `all` then all domains (EX youtube.com, twitter.com) from the author's submission history will be considered
     *
     *  @default all
     * */
    lookAt?: 'media' | 'all',

    /**
     * Should the rule aggregate recognized media domains into the parent domain?
     *
     * Submissions to major media domains (youtube, vimeo) can be identified by individual Channel/Author...
     *
     * * If `false` then aggregate will occur at the channel level IE Youtube Channel A (2 counts), Youtube Channel B  (3 counts)
     * * If `true` then then aggregation will occur at the domain level IE youtube.com (5 counts)
     *
     *  @default false
     * */
    aggregateMediaDomains?: boolean

    /**
     * Include reddit `self.*` domains in aggregation?
     *
     * Self-posts are aggregated under the domain `self.[subreddit]`. If you wish to include these domains in aggregation set this to `true`
     *
     *  @default false
     * */
    includeSelf?: boolean
}

export interface AttributionOptions extends AttributionConfig, RuleOptions {

}

/**
 * Aggregates all of the domain/media accounts attributed to an author's Submission history. If any domain is over the threshold the rule is triggered
 *
 * Available data for [Action templating](https://github.com/FoxxMD/reddit-context-bot#action-templating):
 *
 * ```
 * count      => Total number of repeat Submissions
 * threshold  => The threshold you configured for this Rule to trigger
 * url        => Url of the submission that triggered the rule
 * ```
 * */
export interface AttributionJSONConfig extends AttributionConfig, SubmissionRuleJSONConfig {
    kind: 'attribution'
}
