import {SubmissionRule, SubmissionRuleJSONConfig} from "./index";
import {ActivityWindow, ActivityWindowType, ReferenceSubmission} from "../../Common/interfaces";
import {RuleOptions, RuleResult} from "../index";
import Submission from "snoowrap/dist/objects/Submission";
import {getAttributionIdentifier, getAuthorActivities, getAuthorSubmissions} from "../../Utils/SnoowrapUtils";
import dayjs from "dayjs";

export class AttributionRule extends SubmissionRule {
    threshold: number | string;
    percentVal?: number;
    window: ActivityWindowType;
    useSubmissionAsReference: boolean;
    lookAt: 'media' | 'all' = 'media';
    include: string[];
    exclude: string[];
    includeInTotal: 'submissions' | 'all' = 'submissions';
    aggregateMediaDomains: boolean = false;
    includeSelf: boolean = false;

    constructor(options: AttributionOptions) {
        super(options);
        const {
            threshold = '10%',
            window = 100,
            include = [],
            exclude = [],
            includeInTotal = 'submissions',
            lookAt = 'media',
            aggregateMediaDomains = false,
            useSubmissionAsReference = true,
            includeSelf = false,
        } = options || {};

        this.threshold = threshold;
        if(typeof this.threshold === 'string') {
            this.percentVal = Number.parseInt(this.threshold.replace('%',''))/100;
        }
        this.window = window;
        this.include = include.map(x => x.toLowerCase());
        this.exclude = exclude.map(x => x.toLowerCase());
        this.includeInTotal = includeInTotal;
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
            threshold: this.threshold,
            window: this.window,
            useSubmissionAsReference: this.useSubmissionAsReference,
            include: this.include,
            exclude: this.exclude,
            lookAt: this.lookAt,
            includeInTotal: this.includeInTotal,
            aggregateMediaDomains: this.aggregateMediaDomains,
            includeSelf: this.includeSelf,
        }
    }

    protected async process(item: Submission): Promise<[boolean, RuleResult[]]> {
        const referenceUrl = await item.url;
        if (referenceUrl === undefined && this.useSubmissionAsReference) {
            throw new Error(`Cannot run Rule ${this.name} because submission is not a link`);
        }

        const activities = await getAuthorSubmissions(item.author, {window: this.window}) as Submission[];

        const aggregatedSubmissions = activities.reduce((acc: Map<string, number>, sub) => {
            if (this.include.length > 0) {
                if (!this.include.some(x => x === sub.subreddit.display_name.toLowerCase())) {
                    return acc;
                }

            } else if (this.exclude.length > 0 && this.exclude.some(x => x === sub.subreddit.display_name.toLowerCase())) {
                return acc;
            }

            if (sub.is_self && !this.includeSelf) {
                return acc;
            }

            if (this.lookAt === 'media' && sub.secure_media === undefined) {
                return acc;
            }

            const domain = getAttributionIdentifier(sub, this.aggregateMediaDomains)

            const count = acc.get(domain) || 0;

            acc.set(domain, count + 1);

            return acc;
        }, new Map());

        let activityTotal = 0;

        if (this.includeInTotal === 'submissions') {
            activityTotal = activities.length;
        } else {
            const dur = typeof this.window === 'number' ? dayjs.duration(dayjs().diff(dayjs(activities[activities.length - 1].created * 1000))) : this.window;
            const allActivities = await getAuthorActivities(item.author, {window: dur});
            activityTotal = allActivities.length;
        }

        let triggeredDomains = [];
        for (const [domain, subCount] of aggregatedSubmissions) {
            if (this.percentVal !== undefined && this.percentVal <= subCount / activityTotal) {
                // look for author channel
                const withChannel = activities.find(x => x.secure_media?.oembed?.author_url === domain || x.secure_media?.oembed?.author_name === domain);
                triggeredDomains.push({
                    domain,
                    title: withChannel !== undefined ? (withChannel.secure_media?.oembed?.author_name || withChannel.secure_media?.oembed?.author_url) : domain,
                    count: subCount,
                    percent: Math.round((subCount / activityTotal) * 100)
                });
            }
        }

        const refDomain = this.aggregateMediaDomains ? item.domain : item.secure_media?.oembed?.author_url;
        const refDomainTitle = this.aggregateMediaDomains ? (item.secure_media?.oembed?.provider_name || item.domain) : item.secure_media?.oembed?.author_name;

        if (this.useSubmissionAsReference) {
            // filter triggeredDomains to only reference
            triggeredDomains = triggeredDomains.filter(x => x.domain === refDomain || x.domain === refDomainTitle);
        }

        if (triggeredDomains.length > 0) {
            const largestCount = triggeredDomains.reduce((acc, curr) => Math.max(acc, curr.count), 0);
            const largestPercent = triggeredDomains.reduce((acc, curr) => Math.max(acc, curr.percent), 0);

            const result = `${triggeredDomains.length} Attribution(s) met the threshold of ${this.threshold}, largest being ${largestCount} (${largestPercent}%) of ${activityTotal} Total`;

            const data: any = {
                triggeredDomainCount: triggeredDomains.length,
                largestCount,
                largestPercent,
                threshold: this.threshold,
            };
            if (this.useSubmissionAsReference) {
                data.refDomain = refDomain;
                data.refDomainTitle = refDomainTitle;
            }
            return Promise.resolve([true, [this.getResult(true, {
                result,
                data,
            })]]);
        }

        return Promise.resolve([false, []]);
    }

}

interface AttributionConfig extends ActivityWindow, ReferenceSubmission {
    /**
     * The number or percentage to trigger this rule at
     *
     * * If `threshold` is a `number` then it is the absolute number of attribution instances to trigger at
     * * If `threshold` is a `string` with percentage (EX `40%`) then it is the percentage of the total (see `lookAt`) this attribution must reach to trigger
     *
     * @default 10%
     * */
    threshold?: number | string,

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
     * What activities to use for total count when determining what percentage an attribution comprises
     *
     * EX:
     *
     * Author has 100 activities, 40 are submissions and 60 are comments
     *
     * * If `submission` then if 10 submission are for Youtube Channel A then percentage => 10/40 = 25%
     * * If `all` then if 10 submission are for Youtube Channel A then percentage => 10/100 = 10%
     *
     * @default submissions
     **/
    includeInTotal?: 'submissions' | 'all',

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
