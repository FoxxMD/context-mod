import {SubmissionRule, SubmissionRuleJSONConfig} from "./SubmissionRule";
import {
    DomainInfo,
    ReferenceSubmission,
    RuleResult
} from "../Common/interfaces";
import {Rule, RuleOptions} from "./index";
import Submission from "snoowrap/dist/objects/Submission";
import {getAttributionIdentifier} from "../Utils/SnoowrapUtils";
import dayjs from "dayjs";
import {
    asSubmission, buildFilter, buildSubredditFilter,
    comparisonTextOp, convertSubredditsRawToStrong,
    FAIL,
    formatNumber, getActivitySubredditName, isActivityWindowConfig, isSubmission,
    parseSubredditName,
    PASS, windowConfigToWindowCriteria
} from "../util";
import { Comment } from "snoowrap/dist/objects";
import as from "async";
import {SimpleError} from "../Utils/Errors";
import {CommentState, StrongSubredditCriteria, SubmissionState} from "../Common/Infrastructure/Filters/FilterCriteria";
import {
    ActivityWindowConfig,
    ActivityWindowCriteria,
    HistoryFiltersOptions
} from "../Common/Infrastructure/ActivityWindow";
import {FilterOptions} from "../Common/Infrastructure/Filters/FilterShapes";
import {parseGenericValueOrPercentComparison} from "../Common/Infrastructure/Comparisons";


export interface AttributionCriteria {
    /**
     * A string containing a comparison operator and a value to compare comments against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 12`  => greater than 12 activities originate from same attribution
     * * EX `<= 10%` => less than 10% of all Activities have the same attribution
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @default "> 10%"
     * */
    threshold: string
    window: ActivityWindowConfig
    /**
     * DEPRECATED -- use `window.fetch` instead
     *
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
     * @deprecationMessage use `window.fetch` instead
     **/
    thresholdOn?: 'submissions' | 'all'
    /**
     * The minimum number of activities that must exist for this criteria to run
     * @default 5
     * */
    minActivityCount?: number

    /**
     * A list of domains whose Activities will be tested against `threshold`.
     *
     * The values are tested as partial strings so you do not need to include full URLs, just the part that matters.
     *
     * EX `["youtube"]` will match submissions with the domain `https://youtube.com/c/aChannel`
     * EX `["youtube.com/c/bChannel"]` will NOT match submissions with the domain `https://youtube.com/c/aChannel`
     *
     * If you wish to aggregate on self-posts for a subreddit use the syntax `self.[subreddit]` EX `self.AskReddit`
     *
     * **If this Rule is part of a Check for a Submission and you wish to aggregate on the domain of the Submission use the special string `AGG:SELF`**
     *
     * If nothing is specified or list is empty (default) aggregate using `aggregateOn`
     *
     * @default [[]]
     * */
    domains?: string[],
    /**
     * Set to `true` if you wish to combine all of the Activities from `domains` to test against `threshold` instead of testing each `domain` individually
     *
     * @default false
     * @examples [false]
     * */
    domainsCombined?: boolean,

    /**
     * DEPRECATED - use `window.filterOn.post.subreddits` instead
     *
     * When present, Activities WILL ONLY be counted if they are found in this list of Subreddits
     *
     * Each value in the list can be either:
     *
     *  * string (name of subreddit)
     *  * regular expression to run on the subreddit name
     *  * `SubredditState`
     *
     * EX `["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]`
     * @examples [["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]]
     * @deprecationMessage use `window.filterOn.post.subreddits` instead
     * */
    include?: string[],
    /**
     * DEPRECATED - use `window.filterOn.post.subreddits` instead
     *
     * When present, Activities WILL NOT be counted if they are found in this list of Subreddits
     *
     * Each value in the list can be either:
     *
     *  * string (name of subreddit)
     *  * regular expression to run on the subreddit name
     *  * `SubredditState`
     *
     * EX `["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]`
     * @examples [["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]]
     * @deprecationMessage use `window.filterOn.post.subreddits` instead
     * */
    exclude?: string[],

    /**
     * When present, Submissions from `window` will only be counted if they meet this criteria
     *
     * @deprecationMessage use `window.filterOn.post.submissionState` instead
     * */
    submissionState?: SubmissionState
    /**
     * DEPRECATED - use `window.filterOn.post.commentState` instead
     *
     * When present, Comments from `window` will only be counted if they meet this criteria
     *
     * @deprecationMessage use `window.filterOn.post.commentState` instead
     * */
    commentState?: CommentState

    /**
     * This list determines which categories of domains should be aggregated on. All aggregated domains will be tested against `threshold`
     *
     * * If `media` is included then aggregate author's submission history which reddit recognizes as media (youtube, vimeo, etc.)
     * * If `redditMedia` is included then aggregate on author's submissions history which are media hosted on reddit: galleries, videos, and images (i.redd.it / v.redd.it)
     * * If `self` is included then aggregate on author's submission history which are self-post (`self.[subreddit]`) or domain is `reddit.com`
     * * If `link` is included then aggregate author's submission history which is external links and not recognized as `media` by reddit
     *
     * If nothing is specified or list is empty (default) rule will only aggregate on `link` and `media` (ignores reddit-hosted content and self-posts)
     *
     *  @default undefined
     *  @examples [[]]
     * */
    aggregateOn?: ('media' | 'redditMedia' | 'self' | 'link')[],

    /**
     * Should the criteria consolidate recognized media domains into the parent domain?
     *
     * Submissions to major media domains (youtube, vimeo) can be identified by individual Channel/Author...
     *
     * * If `false` then domains will be aggregated at the channel level IE Youtube Channel A (2 counts), Youtube Channel B  (3 counts)
     * * If `true` then then media domains will be consolidated at domain level and then aggregated IE youtube.com (5 counts)
     *
     *  @default false
     *  @examples [false]
     * */
    consolidateMediaDomains?: boolean

    name?: string
}

export interface StrongAttributionCriteria extends Omit<AttributionCriteria, 'window' | 'include' | 'exclude' | 'submissionState' | 'commentState' | 'thresholdOn'> {
    window: ActivityWindowCriteria
}

const SUBMISSION_DOMAIN = 'AGG:SELF';

const defaultCriteria = [{threshold: '10%', window: 100}] as AttributionCriteria[];

interface DomainAgg {
    info: DomainInfo,
    count: number
}

interface AttributionData {
    config: AttributionCriteria
    criteria: StrongAttributionCriteria
}

export class AttributionRule extends Rule {
    criteria: AttributionData[];
    criteriaJoin: 'AND' | 'OR';

    constructor(options: AttributionOptions) {
        super(options);
        const {
            criteria: criterias = defaultCriteria,
            criteriaJoin = 'OR',
        } = options || {};

        this.criteria = [];
        this.criteriaJoin = criteriaJoin;
        if (criterias.length === 0) {
            throw new Error('Must provide at least one AttributionCriteria');
        }

        let index = 1;
        for(const criteria of criterias) {

            const {
                threshold = '> 10%',
                window,
                thresholdOn,
                minActivityCount = 10,
                aggregateOn = ['link','media'],
                consolidateMediaDomains = false,
                domains = [],
                domainsCombined = false,
                include = [],
                exclude = [],
                commentState,
                submissionState,
            } = criteria;

            const strongWindow = windowConfigToWindowCriteria(window);
            if(thresholdOn !== undefined) {
                this.logger.warn(`Criteria #${index} use 'thresholdOn' which is deprecated. Use 'window.fetch' on this Criteria instead`);
                if(strongWindow.fetch !== undefined) {
                    this.logger.warn(`Criteria #${index} defines both 'window.fetch' and 'thresholdOn'. Only one should be defined -- 'window.fetch' will take precedence.`);
                } else if(thresholdOn === 'submissions') {
                    strongWindow.fetch = 'submission';
                }
            }

            const {
                filterOn: {
                    post: {
                        subreddits: {
                            include: windowSubInclude = undefined,
                            exclude: windowSubExclude = undefined,
                        } = {},
                        commentState: windowCommentState = undefined,
                        submissionState: windowSubmissionState = undefined,
                    } = {},
                } = {},
            } = strongWindow;

            const subFilter = include.length > 0 || exclude.length > 0 ? buildSubredditFilter({include, exclude}) : undefined;
            if(subFilter !== undefined) {
                this.logger.warn(`Criteria #${index} defines 'include' or 'exclude' which are deprecated. Use 'window.filterOn.post.subreddits' on this Criteria instead.`);

                if(include.length > 0) {
                    if(windowSubInclude !== undefined) {
                        this.logger.warn(`Criteria #${index} defines a top-level 'include' and 'window.filterOn.subreddits.include'. Only one should be defined. Window filter will take precedence.`);
                        subFilter.include = windowSubInclude;
                    }
                }
                if(exclude.length > 0) {
                    if(windowSubExclude !== undefined) {
                        this.logger.warn(`Criteria #${index} defines a top-level 'exclude' and 'window.filterOn.subreddits.exclude'. Only one should be defined. Window filter will take precedence.`);
                        subFilter.include = windowSubExclude;
                    }
                }
                strongWindow.filterOn = {
                ...(strongWindow.filterOn ?? {}),
                    post: {
                        ...(strongWindow.filterOn?.post ?? {}),
                        ...subFilter,
                    }
                }
            }

            if(commentState !== undefined) {
                this.logger.warn(`Criteria #${index} defines 'commentState' which is deprecated. Use 'window.filterOn.post.commentState' instead`);
                if(windowCommentState !== undefined) {
                    this.logger.warn(`Criteria #${index} both 'commentState' and 'window.filterOn.post.commentState'. Only one should be defined. Window filter will take precedence.`);
                } else {
                    strongWindow.filterOn = {
                        ...(strongWindow.filterOn ?? {}),
                        post: {
                            ...(strongWindow.filterOn?.post ?? {}),
                            commentState: buildFilter({include: [commentState]}),
                        }
                    }
                }
            }
            if(submissionState !== undefined) {
                this.logger.warn(`Criteria #${index} defines 'submissionState' which is deprecated. Use 'window.filterOn.post.submissionState' instead`);
                if(windowSubmissionState !== undefined) {
                    this.logger.warn(`Criteria #${index} both 'submissionState' and 'window.filterOn.post.submissionState'. Only one should be defined. Window filter will take precedence.`);
                } else {
                    strongWindow.filterOn = {
                        ...(strongWindow.filterOn ?? {}),
                        post: {
                            ...(strongWindow.filterOn?.post ?? {}),
                            submissionState: buildFilter({include: [submissionState]}),
                        }
                    }
                }
            }

            this.criteria.push({
                config: criteria,
                criteria: {
                    threshold,
                    window: strongWindow,
                    minActivityCount,
                    aggregateOn,
                    consolidateMediaDomains,
                    domains,
                    domainsCombined,
                }
            })

            index++;
        }
    }

    getKind(): string {
        return "attribution";
    }

    protected getSpecificPremise(): object {
        return {
            criteria: this.criteria,
            criteriaJoin: this.criteriaJoin,
        }
    }

    protected async process(item: Comment | Submission): Promise<[boolean, RuleResult]> {
        let criteriaResults = [];

        for (const criteria of this.criteria) {

            const {
                threshold = '> 10%',
                window,
                minActivityCount = 10,
                aggregateOn = ['link','media'],
                consolidateMediaDomains = false,
                domains = [],
                domainsCombined = false,
            } = criteria.criteria;

            const {operator, value, isPercent, extra = ''} = parseGenericValueOrPercentComparison(threshold);

            let activities = await this.resources.getAuthorActivities(item.author, window);

            let activityTotal = 0;
            let firstActivity, lastActivity;

            if(activities.length === 0) {
                this.logger.debug(`No activities retrieved for criteria`);
                continue;
            }

            activityTotal = activities.length;
            firstActivity = activities[0];
            lastActivity = activities[activities.length - 1];

            const activityTotalWindow = dayjs.duration(dayjs(firstActivity.created_utc * 1000).diff(dayjs(lastActivity.created_utc * 1000)));

            if (activities.length < minActivityCount) {
                criteriaResults.push({criteria, activityTotal, activityTotalWindow, triggered: false, aggDomains: [], minCountMet: false});
                this.logger.debug(`${activities.length } activities retrieved was less than min activities required to run criteria (${minActivityCount})`);
                continue;
            }

            const realDomains: DomainInfo[] = domains.map(x => {
                if(x === SUBMISSION_DOMAIN) {
                    if(!(asSubmission(item))) {
                        throw new SimpleError('Cannot run Attribution Rule with the domain SELF:AGG on a Comment');
                    }
                    return getAttributionIdentifier(item, consolidateMediaDomains);
                }
                return {display: x, domain: x, aliases: [x]};
            });
            const realDomainIdents = realDomains.map(x => x.aliases).flat(1).map(x => x.toLowerCase());

            const submissions: Submission[] = window.fetch === 'submission' ? activities as Submission[] : activities.filter(x => isSubmission(x)) as Submission[];
            const aggregatedSubmissions = submissions.reduce((acc: Map<string, DomainAgg>, sub) => {
                const domainInfo = getAttributionIdentifier(sub, consolidateMediaDomains)

                let domainType = 'link';
                if(sub.is_video || ['i.redd.it','v.redd.it'].includes(sub.domain)
                    // @ts-ignore
                    || sub.gallery_data !== undefined) {
                    domainType = 'redditMedia';
                } else if(sub.is_self || sub.domain === 'reddit.com') {
                    domainType = 'self';
                } else if(sub.secure_media !== undefined && sub.secure_media !== null) {
                    domainType = 'media';
                }

                if(aggregateOn.length !== 0) {
                    if(domainType === 'media' && !aggregateOn.includes('media')) {
                        return acc;
                    }
                    if(domainType === 'redditMedia' && !aggregateOn.includes('redditMedia')) {
                        return acc;
                    }
                    if(domainType === 'self' && !aggregateOn.includes('self')) {
                        return acc;
                    }
                    if(domainType === 'link' && !aggregateOn.includes('link')) {
                        return acc;
                    }
                }

                if(realDomains.length > 0) {
                    if(domainInfo.aliases.map(x => x.toLowerCase()).some(x => realDomainIdents.includes(x))) {
                        const domainAgg = acc.get(domainInfo.display) || {info: domainInfo, count: 0};
                        acc.set(domainInfo.display, {...domainAgg, count: domainAgg.count + 1});
                    }
                } else {
                    const domainAgg = acc.get(domainInfo.display) || {info: domainInfo, count: 0};
                    acc.set(domainInfo.display, {...domainAgg, count: domainAgg.count + 1});
                }

                return acc;
            }, new Map());

            let aggDomains = [];

            if(domainsCombined) {
                let combinedCount = 0;
                let domains = [];
                let triggered = false;
                for (const [domain, dAgg] of aggregatedSubmissions) {
                    domains.push(domain);
                    combinedCount += dAgg.count;
                }
                if(isPercent) {
                    triggered = comparisonTextOp(combinedCount / activityTotal, operator, (value/100));
                }
                else {
                    triggered = comparisonTextOp(combinedCount, operator, value);
                }
                const combinedDomain = Array.from(aggregatedSubmissions.values()).map(x => x.info.domain).join(' and ');
                const combinedDisplay = Array.from(aggregatedSubmissions.values()).map(x => `${x.info.display}${x.info.provider !== undefined ? ` (${x.info.provider})` : ''}`).join(' and ');
                aggDomains.push({
                    domain: {display: combinedDisplay, domain: combinedDomain, aliases: [combinedDomain]},
                    count: combinedCount,
                    percent: Math.round((combinedCount / activityTotal) * 100),
                    triggered,
                });

            } else {
                for (const [domain, dAgg] of aggregatedSubmissions) {
                    let triggered = false;
                    if(isPercent) {
                        triggered = comparisonTextOp(dAgg.count / activityTotal, operator, (value/100));
                    }
                    else {
                        triggered = comparisonTextOp(dAgg.count, operator, value);
                    }

                    aggDomains.push({
                        domain: dAgg.info,
                        count: dAgg.count,
                        percent: Math.round((dAgg.count / activityTotal) * 100),
                        triggered,
                    });
                }
            }

            criteriaResults.push({criteria, activityTotal, activityTotalWindow, aggDomains, minCountMet: true});
        }

        let criteriaMeta = false;
        if (this.criteriaJoin === 'OR') {
            criteriaMeta = criteriaResults.some(x => x.aggDomains.length > 0 && x.aggDomains.some(y => y.triggered === true));
        } else {
            criteriaMeta = criteriaResults.every(x => x.aggDomains.length > 0 && x.aggDomains.some(y => y.triggered === true));
        }

        let usableCriteria = criteriaResults.filter(x => x.aggDomains.length > 0 && x.aggDomains.some(y => y.triggered === true));
        if (usableCriteria.length === 0) {
            usableCriteria = criteriaResults.filter(x => x.aggDomains.length > 0)
        }
        // probably none hit min count then
        if(criteriaResults.every(x => x.minCountMet === false)) {
            const result = `${FAIL} No criteria had their min activity count met`;
            this.logger.verbose(result);
            return Promise.resolve([false, this.getResult(false, {result})]);
        }

        let result;
        const refCriteriaResults = usableCriteria.find(x => x !== undefined);
        if(refCriteriaResults === undefined) {
            result = `${FAIL} No criteria results found??`;
            return Promise.resolve([false, this.getResult(false, {result})])
        }

        const {
            aggDomains = [],
            activityTotal,
            activityTotalWindow,
            criteria: {
                criteria: {
                    threshold
                },
                config: {
                    window
                }
            }
        } = refCriteriaResults;

        const largestCount = aggDomains.reduce((acc, curr) => Math.max(acc, curr.count), 0);
        const largestPercent = aggDomains.reduce((acc, curr) => Math.max(acc, curr.percent), 0);
        const smallestCount = aggDomains.reduce((acc, curr) => Math.min(acc, curr.count), aggDomains[0].count);
        const smallestPercent = aggDomains.reduce((acc, curr) => Math.min(acc, curr.percent), aggDomains[0].percent);
        const windowText = typeof window === 'number' ? `${activityTotal} Items` : activityTotalWindow.humanize();
        const countRange = smallestCount === largestCount ? largestCount : `${smallestCount} - ${largestCount}`
        const percentRange = formatNumber(smallestPercent, {toFixed: 0}) === formatNumber(largestPercent, {toFixed: 0}) ? `${largestPercent}%` : `${smallestPercent}% - ${largestPercent}%`

        let data: any = {};
        const resultAgnostic = `met the threshold of ${threshold}, with ${countRange} (${percentRange}) of ${activityTotal} Total -- window: ${windowText}`;

        if(criteriaMeta) {
            result = `${PASS} ${aggDomains.length} Attribution(s) ${resultAgnostic}`;
            data = {
                triggeredDomainCount: aggDomains.length,
                activityTotal,
                largestCount,
                largestPercent: `${largestPercent}%`,
                smallestCount,
                smallestPercent: `${smallestPercent}%`,
                countRange,
                percentRange,
                domains: aggDomains.map(x => x.domain.domain),
                domainsDelim: aggDomains.map(x => x.domain.domain).join(', '),
                titles: aggDomains.map(x => `${x.domain.display}${x.domain.provider !== undefined ? ` (${x.domain.provider})` :''}`),
                titlesDelim: aggDomains.map(x => `${x.domain.display}${x.domain.provider !== undefined ? ` (${x.domain.provider})` :''}`).join(', '),
                threshold: threshold,
                window: windowText
            };
        } else {
            result = `${FAIL} No Attributions ${resultAgnostic}`;
        }

        this.logger.verbose(result);
        return Promise.resolve([criteriaMeta, this.getResult(criteriaMeta, {
            result,
            data,
        })]);
    }

}

interface AttributionConfig {

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
}

export interface AttributionOptions extends AttributionConfig, RuleOptions {

}

/**
 * Aggregates all of the domain/media accounts attributed to an author's Submission history. If any domain is over the threshold the rule is triggered
 *
 * Available data for [Action templating](https://github.com/FoxxMD/context-mod#action-templating):
 *
 * ```
 * triggeredDomainCount => Number of domains that met the threshold
 * activityTotal        => Number of Activities considered from window
 * window               => The date range of the Activities considered
 * largestCount         => The count from the largest aggregated domain
 * largestPercentage    => The percentage of Activities the largest aggregated domain comprises
 * smallestCount        => The count from the smallest aggregated domain
 * smallestPercentage   => The percentage of Activities the smallest aggregated domain comprises
 * countRange           => A convenience string displaying "smallestCount - largestCount" or just one number if both are the same
 * percentRange         => A convenience string displaying "smallestPercentage - largestPercentage" or just one percentage if both are the same
 * domains              => An array of all the domain URLs that met the threshold
 * domainsDelim         => A comma-delimited string of all the domain URLs that met the threshold
 * titles               => The friendly-name of the domain if one is present, otherwise the URL (IE youtube.com/c/34ldfa343 => "My Youtube Channel Title")
 * titlesDelim          => A comma-delimited string of all the domain friendly-names
 * threshold            => The threshold you configured for this Rule to trigger
 * url                  => Url of the submission that triggered the rule
 * ```
 * */
export interface AttributionJSONConfig extends AttributionConfig, SubmissionRuleJSONConfig {
    kind: 'attribution'
}
