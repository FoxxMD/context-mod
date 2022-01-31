import {Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import {Listing, SearchOptions} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {
    compareDurationValue,
    comparisonTextOp,
    FAIL, formatNumber,
    isRepostItemResult, parseDurationComparison, parseGenericValueComparison,
    parseUsableLinkIdentifier,
    PASS, searchAndReplace, stringSameness, triggeredIndicator, windowToActivityWindowCriteria, wordCount
} from "../util";
import {
    ActivityWindow,
    ActivityWindowType,
    CompareValue, DurationComparor,
    JoinOperands,
    RepostItem,
    RepostItemResult,
    SearchAndReplaceRegExp,
    SearchFacetType, TextMatchOptions, TextTransformOptions,
} from "../Common/interfaces";
import objectHash from "object-hash";
import {getActivities, getAttributionIdentifier} from "../Utils/SnoowrapUtils";
import Fuse from "fuse.js";
import leven from "leven";
import {YoutubeClient, commentsAsRepostItems} from "../Utils/ThirdParty/YoutubeClient";
import dayjs from "dayjs";
import {rest} from "lodash";

const parseYtIdentifier = parseUsableLinkIdentifier();

export interface SearchFacetJSONConfig extends TextMatchOptions, TextTransformOptions, ActivityWindow {
    kind: SearchFacetType | SearchFacetType[]
}

export interface SearchFacet extends SearchFacetJSONConfig {
    kind: SearchFacetType
}

export type TimeBasedSelector = "newest" | "oldest" | "any" | "all";

export interface OccurredAt {
    /**
     * Which repost to test on
     *
     * * `any` -- ANY repost passing `condition` will cause this criteria to be true
     * * `all` -- ALL reposts must pass `condition` for this criteria to be true
     * */
    "testOn": TimeBasedSelector,
    "condition": DurationComparor
}

export interface OccurrenceTests {
    count?: {
        condition?: JoinOperands
        /**
         * An array of strings containing a comparison operator and the number of repost occurrences to compare against
         *
         * Examples:
         *
         * * `">= 7"` -- TRUE if 7 or more reposts were found
         * * `"< 1"` -- TRUE if less than 0 reposts were found
         * */
         test: CompareValue[]
    }

    /**
     * Test the time the reposts occurred at
     * */
    time?: {
        /**
         * How to test all the specified comparisons
         *
         * * AND -- All criteria must be true
         * * OR -- Any criteria must be true
         *
         * Defaults to AND
         *
         * @default AND
         * @example ["AND", "OR"]
         * */
        condition?: JoinOperands
        /**
         * An array of time-based conditions to test against found reposts (test when a repost was made)
         * */
        test: OccurredAt[]
    }
}

/**
 * A set of criteria used to find reposts
 *
 * Contains options and conditions used to define how candidate reposts are retrieved and if they are a match.
 *
 * */
export interface RepostCriteria extends ActivityWindow, TextMatchOptions, TextTransformOptions  {
    /**
     * Define how to find candidate reposts
     *
     * * **title** -- search reddit for submissions with the same title
     * * **url** -- search reddit for submissions with the same url
     * * **external** -- WHEN ACTIVITY IS A COMMENT - tries to get comments from external source (youtube, twitter, etc...)
     * */
    searchOn?: (SearchFacetType | SearchFacetJSONConfig)[]

    /**
     * A set of comparisons to test against the number of reposts found
     *
     * If not specified the default is "AND [occurrences] > 0" IE any reposts makes this test pass
     * */
    occurrences?: {
        /**
         * How to test all the specified comparisons
         *
         * * AND -- All criteria must be true
         * * OR -- Any criteria must be true
         *
         * Defaults to AND
         *
         * @default AND
         * @example ["AND", "OR"]
         * */
        condition?: JoinOperands

        criteria?: OccurrenceTests[]
    }

    /**
     * Test the time the reposts occurred at
     * */
    occurredAt?: {
        /**
         * How to test all the specified comparisons
         *
         * * AND -- All criteria must be true
         * * OR -- Any criteria must be true
         *
         * Defaults to AND
         *
         * @default AND
         * @example ["AND", "OR"]
         * */
        condition?: JoinOperands
        /**
         * An array of time-based conditions to test against found reposts (test when a repost was made)
         * */
        criteria: OccurredAt[]
    }

    /**
     * The maximum number of comments/submissions to check
     *
     * In both cases this list is gathered from sorting all submissions or all comments from all submission by number of votes and taking the "top" maximum specified
     *
     * For comment checks this is the number of comments cached
     *
     * @default 50
     * @example [50]
     * */
    maxRedditItems?: number

    /**
     * The maximum number of external items (youtube comments) to check (and cache for comment checks)
     *
     * @default 50
     * @example [50]
     * */
    maxExternalItems?: number
}

export interface CriteriaResult {
    passed: boolean
    conditionsSummary: string
    items: RepostItemResult[]
}

const parentSubmissionSearchFacetDefaults = {
    title: {
        matchScore: 85,
        minWordCount: 3
    },
    url: {
        matchScore: 0, // when looking for submissions to find repost comments on automatically include any with exact same url
    },
    duplicates: {
        matchScore: 0, // when looking for submissions to find repost comments on automatically include any that reddit thinks are duplicates
    },
    crossposts: {
        matchScore: 0, // when looking for submissions to find repost comments on automatically include any that reddit thinks are crossposts
    },
    external: {}
}

const isSearchFacetType = (val: any): val is SearchFacetType => {
    if (typeof val === 'string') {
        return ['title', 'url', 'duplicates', 'crossposts', 'external'].includes(val);
    }
    return false;
}

const generateSearchFacet = (val: SearchFacetType | SearchFacetJSONConfig): SearchFacet[] => {
    let facets: SearchFacet[] = [];
    if (isSearchFacetType(val)) {
        facets.push({
            kind: val
        });
    } else if (Array.isArray(val.kind)) {
        facets.concat(val.kind.map(x => ({...val, kind: x})));
    } else {
        facets.push(val as SearchFacet);
    }

    return facets.map(x => {
        return {
            ...parentSubmissionSearchFacetDefaults[x.kind],
            ...x,
        }
    });
}

export class RepostRule extends Rule {
    criteria: RepostCriteria[]
    condition: JoinOperands;

    submission?: Submission;

    constructor(options: RepostRuleOptions) {
        super(options);
        const {
            criteria = [{}],
            condition = 'OR'
        } = options || {};
        if (criteria.length < 1) {
            throw new Error('Must provide at least one RepostCriteria');
        }
        this.criteria = criteria;
        this.condition = condition;
    }

    getKind(): string {
        return 'Repost';
    }

    protected getSpecificPremise(): object {
        return {
            criteria: this.criteria,
            condition: this.condition
        }
    }

    // @ts-ignore
    protected async getSubmission(item: Submission | Comment) {
        if (item instanceof Comment) {
            // @ts-ignore
            return await this.client.getSubmission(item.link_id).fetch();
        }
        return item;
    }

    protected async process(item: Submission | Comment): Promise<[boolean, RuleResult]> {

        let criteriaResults: CriteriaResult[] = [];
        let ytClient: YoutubeClient | undefined = undefined;
        let criteriaMatchedResults: RepostItemResult[] = [];
        let totalSubs = 0;
        let totalCommentSubs = 0;
        let totalComments = 0;
        let totalExternal = new Map<string,number>();
        let fromCache = false;
        let andFail = false;

        for (const rCriteria of this.criteria) {
            criteriaMatchedResults = [];
            const {
                searchOn = (item instanceof Submission ? ['title', 'url', 'duplicates', 'crossposts'] : ['external', 'title', 'url', 'duplicates', 'crossposts']),
                //criteria = {},
                maxRedditItems = 50,
                maxExternalItems = 50,
                window = 20,
                ...restCriteria
            } = rCriteria;

            const searchFacets = searchOn.map(x => generateSearchFacet(x)).flat(1) as SearchFacet[];

            const includeCrossposts = searchFacets.some(x => x.kind === 'crossposts');

            // in getDuplicate() options add "crossposts_only=1" to get only crossposts https://www.reddit.com/r/redditdev/comments/b4t5g4/get_all_the_subreddits_that_a_post_has_been/
            // if a submission is a crosspost it has "crosspost_parent" attribute https://www.reddit.com/r/redditdev/comments/l46y2l/check_if_post_is_a_crosspost/

            const strongWindow = windowToActivityWindowCriteria(window);

            const candidateHash = `repostItems-${item instanceof Submission ? item.id : item.link_id}-${objectHash.sha1({
                window,
                searchOn
            })}`;
            let items: (RepostItem|RepostItemResult)[] = [];
            let cacheRes = undefined;
            if (item instanceof Comment) {
                cacheRes = await this.resources.cache.get(candidateHash) as ((RepostItem|RepostItemResult)[] | undefined | null);
            }

            if (cacheRes === undefined || cacheRes === null) {

                const sub = await this.getSubmission(item);
                let dups: (Submission[] | undefined) = undefined;

                for (const sf of searchFacets) {

                    const {
                        matchScore = 85,
                        minWordCount = 3,
                        transformations = [],
                    } = sf;

                    if (sf.kind === 'external') {
                        const attribution = getAttributionIdentifier(sub);
                        switch (attribution.provider) {
                            case 'YouTube':
                                const ytCreds = this.resources.getThirdPartyCredentials('youtube')
                                if (ytCreds === undefined) {
                                    throw new Error('Cannot extract comments from Youtube because a Youtube Data API key was not provided in configuration');
                                }
                                if (ytClient === undefined) {
                                    ytClient = new YoutubeClient(ytCreds.apiKey);
                                }
                                const ytComments = commentsAsRepostItems(await ytClient.getVideoTopComments(sub.url, maxExternalItems));
                                items = items.concat(ytComments)
                                totalExternal.set('Youtube comments', (totalExternal.get('Youtube comments') ?? 0) + ytComments.length);
                                break;
                            default:
                                if (attribution.provider === undefined) {
                                    this.logger.debug('Unable to determine external provider');
                                    continue;
                                } else {
                                    this.logger.debug(`External parsing of ${attribution} is not supported yet.`);
                                    continue;
                                }
                        }
                    } else {
                        let subs: Submission[];

                        if (['title', 'url'].includes(sf.kind)) {
                            let query: string;
                            let searchFunc: (limit: number) => Promise<Listing<Submission | Comment>>;
                            if (sf.kind === 'title') {
                                query = (await this.getSubmission(item)).title;
                                searchFunc = (limit: number) => {
                                    let opts: SearchOptions = {
                                        query,
                                        limit,
                                        sort: 'relevance'
                                    };
                                    if (strongWindow.subreddits?.include !== undefined && strongWindow.subreddits?.include.length > 0) {
                                        opts.restrictSr = true;
                                        opts.subreddit = strongWindow.subreddits?.include.join('+');
                                    }
                                    return this.client.search(opts);
                                }
                            } else {
                                const attr = getAttributionIdentifier(sub);
                                if (attr.provider === 'YouTube') {
                                    const ytId = parseYtIdentifier(sub.url);
                                    query = `url:https://youtu.be/${ytId}`;
                                } else {
                                    query = `url:${sub.url}`;
                                }
                                searchFunc = (limit: number) => {
                                    let opts: SearchOptions = {
                                        query,
                                        limit,
                                        sort: 'top'
                                    };
                                    if (strongWindow.subreddits?.include !== undefined && strongWindow.subreddits?.include.length > 0) {
                                        opts.restrictSr = true;
                                        opts.subreddit = strongWindow.subreddits?.include.join('+');
                                    }
                                    return this.client.search(opts);
                                }
                            }
                            subs = await getActivities(searchFunc, {window: strongWindow}) as Submission[];
                        } else {

                            if (dups === undefined) {
                                let searchFunc: (limit: number) => Promise<Listing<Submission | Comment>> = (limit: number) => {
                                    // this does not work correctly
                                    // see https://github.com/not-an-aardvark/snoowrap/issues/320
                                    // searchFunc = (limit: number) => {
                                    //     return sub.getDuplicates({crossposts_only: 0, limit});
                                    // };
                                    return this.client.oauthRequest({
                                        uri: `duplicates/${sub.id}`,
                                        qs: {
                                            limit,
                                        }
                                    }).then(x => {
                                        return Promise.resolve(x.comments) as Promise<Listing<Submission>>
                                    });
                                };
                                subs = await getActivities(searchFunc, {window: strongWindow}) as Submission[];
                                dups = subs;
                            } else {
                                subs = dups;
                            }

                            if (sf.kind === 'duplicates') {
                                // @ts-ignore
                                subs = subs.filter(x => x.crosspost_parent === undefined)
                            } else {
                                // @ts-ignore
                                subs = subs.filter(x => x.crosspost_parent !== undefined && x.crosspost_parent === sub.id)
                            }
                        }

                        // filter by minimum word count
                        subs = subs.filter(x => wordCount(x.title) > minWordCount);

                        items = items.concat(subs.map(x => ({
                            value: searchAndReplace(x.title, transformations),
                            createdOn: x.created,
                            source: 'reddit',
                            sourceUrl: x.permalink,
                            id: x.id,
                            score: x.score,
                            itemType: 'submission',
                            acquisitionType: sf.kind,
                            sourceObj: x,
                            reqSameness: matchScore,
                        })));

                    }
                }

                if (!includeCrossposts) {
                    const sub = await this.getSubmission(item);
                    // remove submissions if they are official crossposts of the submission being checked and searchOn did not include 'crossposts'
                    items = items.filter(x => x.itemType !== 'submission' || !(x.sourceObj.crosspost_parent !== undefined && x.sourceObj.crosspost_parent === sub.id))
                }

                let sourceTitle = searchAndReplace(sub.title, restCriteria.transformationsActivity ?? []);

                // do submission scoring BEFORE pruning duplicates bc...
                // might end up in a situation where we get same submission for both title and url
                // -- url is always a repost but title is not guaranteed and we if remove the url item but not the title we could potentially filter the title submission out and miss this repost
                items = items.reduce((acc: (RepostItem|RepostItemResult)[], x) => {
                    if(x.itemType === 'submission') {
                        totalSubs++;
                        const sf = searchFacets.find(y => y.kind === x.acquisitionType) as SearchFacet;

                        let cleanTitle = x.value;
                        if (!(sf.caseSensitive ?? false)) {
                            cleanTitle = cleanTitle.toLowerCase();
                        }
                        const strMatchResults = stringSameness(sourceTitle, cleanTitle);
                        if(strMatchResults.highScoreWeighted >= (x.reqSameness as number)) {
                            return acc.concat({
                                ...x,
                                sameness: Math.min(strMatchResults.highScoreWeighted, 100),
                            });
                        }
                        return acc;
                    }
                    return acc.concat(x);
                }, []);

                // now remove duplicate submissions
                items = items.reduce((acc: RepostItem[], curr) => {
                    if(curr.itemType !== 'submission') {
                        return acc.concat(curr);
                    }
                    const subId = curr.sourceObj.id;
                    if (sub.id !== subId && !acc.some(x => x.itemType === 'submission' && x.sourceObj.id === subId)) {
                        return acc.concat(curr);
                    }
                    return acc;
                }, []);


                if (item instanceof Comment) {
                    // we need to gather comments from submissions

                    // first cut down the number of submissions to retrieve because we don't care about have ALL submissions,
                    // just most popular comments (which will be in the most popular submissions)
                    let subs = items.filter(x => x.itemType === 'submission').map(x => x.sourceObj) as Submission[];
                    totalCommentSubs += subs.length;

                    const nonSubItems = items.filter(x => x.itemType !== 'submission' && wordCount(x.value) > (restCriteria.minWordCount ?? 3));

                    subs.sort((a, b) => a.score - b.score).reverse();
                    // take top 10 submissions
                    subs = subs.slice(0, 10);

                    let comments: Comment[] = [];
                    for (const sub of subs) {

                        const commFunc = (limit: number) => {
                            return this.client.oauthRequest({
                                uri: `${sub.subreddit_name_prefixed}/comments/${sub.id}`,
                                // get ONLY top-level comments, sorted by Top
                                qs: {
                                    sort: 'top',
                                    depth: 0,
                                    limit,
                                }
                            }).then(x => {
                                return x.comments as Promise<Listing<Comment>>
                            });
                        }
                        // and return the top 20 most popular
                        const subComments = await getActivities(commFunc, {window: {count: 20}, skipReplies: true}) as Listing<Comment>;
                        comments = comments.concat(subComments);
                    }

                    // sort by highest scores
                    comments.sort((a, b) => a.score - b.score).reverse();
                    // filter out all comments with fewer words than required (prevent false negatives)
                    comments.filter(x => wordCount(x.body) > (restCriteria.minWordCount ?? 3));
                    totalComments += Math.min(comments.length, maxRedditItems);

                    // and take the user-defined maximum number of items
                    items = nonSubItems.concat(comments.slice(0, maxRedditItems).map(x => ({
                        value: searchAndReplace(x.body, restCriteria.transformations ?? []),
                        createdOn: x.created,
                        source: 'reddit',
                        id: x.id,
                        sourceUrl: x.permalink,
                        score: x.score,
                        itemType: 'comment',
                        acquisitionType: 'comment'
                    })));
                }

                // cache items for 20 minutes
                await this.resources.cache.set(candidateHash, items, {ttl: 1200});
            } else {
                items = cacheRes;
                totalExternal = items.reduce((acc, curr) => {
                    if(curr.acquisitionType === 'external') {
                        acc.set(`${curr.source} comments`, (acc.get(`${curr.source} comments`) ?? 0 ) + 1);
                        return acc;
                    }
                    return acc;
                }, new Map<string, number>());
                //totalSubs = items.filter(x => x.itemType === 'submission').length;
                //totalCommentSubs = totalSubs;
                totalComments = items.filter(x => x.itemType === 'comment' && x.source === 'reddit').length;
                fromCache = true;
            }

            const {
                matchScore = 85,
                caseSensitive = false,
                transformations = [],
                transformationsActivity = transformations,
                occurrences = {
                    condition: 'AND',
                    criteria: [
                        {
                            count: {
                                test: ['> 0']
                            }
                        }
                    ]
                },
            } = restCriteria;

            if(item instanceof Submission) {
                // we've already done difference calculations in the searchFacet phase
                // and when the check is for a sub it means we are only checking if the submissions has been reposted which means either:
                // * very similar title (default sameness of 85% or more)
                // * duplicate/same URL -- which is a repost, duh
                // so just add all items to critMatches at this point
                criteriaMatchedResults = criteriaMatchedResults.concat(items.filter(x => "sameness" in x) as RepostItemResult[]);
            } else {
                let sourceContent = searchAndReplace(item.body, transformationsActivity);
                if (!caseSensitive) {
                    sourceContent = sourceContent.toLowerCase();
                }

                for (const i of items) {
                    const itemContent = !caseSensitive ? i.value.toLowerCase() : i.value;
                    const strMatchResults = stringSameness(sourceContent, itemContent);
                    if(strMatchResults.highScoreWeighted >= matchScore) {
                        criteriaMatchedResults.push({
                          ...i,
                            // @ts-ignore
                          reqSameness: matchScore,
                          sameness: Math.min(strMatchResults.highScoreWeighted, 100)
                        });
                    }
                }
            }

            // now do occurrence and time tests

            const {
                condition: occCondition = 'AND',
                criteria: occCriteria = [
                    {
                        count: {
                            test: ['> 0']
                        }
                    }
                ]
            } = occurrences;

            let orPass = false;
            let occurrenceReason = null;

            for(const occurrenceTest of occCriteria) {

                const {
                    count:{
                        condition: oCondition = 'AND',
                        test: oCriteria = []
                    } = {},
                    time: {
                        condition: tCondition = 'AND',
                        test: tCriteria = [],
                    } = {}
                } = occurrenceTest;

                let conditionFailSummaries = [];

                const passedConditions = [];
                const failedConditions = [];

                for (const oc of oCriteria) {
                    const ocCompare = parseGenericValueComparison(oc);
                    const ocMatch = comparisonTextOp(criteriaMatchedResults.length, ocCompare.operator, ocCompare.value);
                    if (ocMatch) {
                        passedConditions.push(oc);
                    } else {
                        failedConditions.push(oc);
                        if (oCondition === 'AND') {
                            conditionFailSummaries.push(`(AND) ${oc} occurrences was not true`);
                            break;
                        }
                    }
                }
                if (passedConditions.length === 0 && oCriteria.length > 0) {
                    conditionFailSummaries.push('(OR) No occurrence tests passed');
                }

                const existingPassed = passedConditions.length;
                if (conditionFailSummaries.length === 0) {
                    const timeAwareReposts = [...criteriaMatchedResults].filter(x => x.createdOn !== undefined).sort((a, b) => (a.createdOn as number) - (b.createdOn as number));
                    for (const tc of tCriteria) {
                        let toTest: RepostItemResult[] = [];
                        const durationCompare = parseDurationComparison(tc.condition);
                        switch (tc.testOn) {
                            case 'newest':
                            case 'oldest':
                                if (tc.testOn === 'newest') {
                                    toTest = timeAwareReposts.slice(-1);
                                } else {
                                    toTest = timeAwareReposts.slice(0, 1);
                                }
                                break;
                            case 'any':
                            case 'all':
                                toTest = timeAwareReposts;
                                break;
                        }
                        const timePass = tc.testOn === 'any' ? toTest.some(x => compareDurationValue(durationCompare, dayjs.unix(x.createdOn as number))) : toTest.every(x => compareDurationValue(durationCompare, dayjs.unix(x.createdOn as number)));
                        if (timePass) {
                            passedConditions.push(tc.condition);
                        } else {
                            failedConditions.push(tc.condition);
                            if (tCondition === 'AND') {
                                conditionFailSummaries.push(`(AND) ${tc.condition} was not true`);
                                break;
                            }
                        }
                    }
                    if (tCriteria.length > 0 && passedConditions.length === existingPassed) {
                        conditionFailSummaries.push('(OR) No time-based tests passed');
                    }
                }

                if(conditionFailSummaries.length !== 0 && occCondition === 'AND') {
                    // failed occurrence tests (high-level)
                    occurrenceReason = conditionFailSummaries.join(' | ');
                    break;
                }

                if(passedConditions.length > 0 && occCondition === 'OR') {
                    occurrenceReason = passedConditions.join(' | ');
                    orPass = true;
                    break;
                }
            }

            let passed = occCriteria.length === 0;

            if(occCriteria.length > 0) {
                if(occCondition === 'OR') {
                    passed = orPass;
                    occurrenceReason = occurrenceReason === null ? 'No occurrence test sets passed' : occurrenceReason;
                } else if(occCondition === 'AND') {
                    passed = occurrenceReason === null;
                    occurrenceReason = occurrenceReason === null ? 'All tests passed' : occurrenceReason;
                }
               //passed = (occCondition === 'OR' && orPass) || (occurrenceFailureReason === null && occCondition === 'AND')
            }

            const results = {
                passed,
                conditionsSummary: occurrenceReason as string,
                items: criteriaMatchedResults
            };
            criteriaResults.push(results)


            if(!results.passed) {
                if(this.condition === 'AND') {
                    andFail = true;
                    break;
                }
            } else if(this.condition === 'OR') {
                break;
            }
            if (!results.passed && this.condition === 'AND') {
                andFail = true;
                break;
            }
        }

        // get all repost items for stats and SCIENCE
        const repostItemResults = [...criteriaResults
            // only want reposts from criteria that passed
            .filter(x => x.passed).map(x => x.items)
            .flat()
            // make sure we are only accumulating unique reposts
            .reduce((acc, curr) => {
            const hash = `${curr.source}-${curr.itemType}-${curr.id}`;
            if (!acc.has(hash)) {
                acc.set(hash, curr);
            }
            return acc;
        }, new Map<string, RepostItemResult>()).values()];

        repostItemResults.sort((a, b) => a.sameness - b.sameness).reverse();
        const foundRepost = criteriaResults.length > 0;


        let avgSameness = null;
        let closestSummary = null;
        let closestSameness = null;
        let searchCandidateSummary = '';

        if(item instanceof Comment) {
            searchCandidateSummary = `Searched top ${totalComments} comments in top 10 ${fromCache ? '' : `of ${totalCommentSubs} `}most popular submissions`;
            if(totalExternal.size > 0) {
                searchCandidateSummary += ", ";
                const extSumm: string[] = [];
                totalExternal.forEach((v, k) => {
                    extSumm.push(`${v} ${k}`);
                });
                searchCandidateSummary += extSumm.join(', ');
            }
        } else {
            searchCandidateSummary = `Searched ${totalSubs}`
        }

        let summary = `${searchCandidateSummary} and found ${repostItemResults.length} reposts.`;

        if(repostItemResults.length > 0) {
            avgSameness = formatNumber(repostItemResults.reduce((acc, curr) => acc + curr.sameness, 0) / criteriaResults.length);
            const closest = repostItemResults[0];
            summary += ` --- Closest Match => >> ${closest.value} << from ${closest.source} (${closest.sourceUrl}) with ${formatNumber(closest.sameness)}% sameness.`
            closestSummary = `matched a ${closest.itemType} from ${closest.source}`;
            closestSameness = closest.sameness;
            if(criteriaResults.length > 1) {
                summary += ` Avg ${formatNumber(avgSameness)}%`;
            }
        }

        let passed;

        if(this.condition === 'AND') {
            const failedCrit = criteriaResults.find(x => !x.passed);
            if(failedCrit !== undefined) {
                summary += `BUT a criteria failed >> ${failedCrit.conditionsSummary} << and rule has AND condition.`;
                passed = false;
            } else {
                passed = true;
            }
        } else {
            const passedCrit = criteriaResults.find(x => x.passed);
            if(passedCrit === undefined) {
                summary += `BUT all criteria failed`;
                passed = false;
            } else {
                passed = true;
            }
        }

        const result = `${passed ? PASS : FAIL} ${summary}`;
        this.logger.verbose(result);

        return [passed, this.getResult(passed, {
            result,
            data: {
                allResults: criteriaResults,
                closestSameness: passed ? formatNumber(closestSameness as number) : undefined,
                closestSummary: passed ? closestSummary : undefined,
            }
        })];
    }
}

interface RepostConfig {
    /**
     * A list of Regular Expressions and conditions under which tested Activity(ies) are matched
     * @minItems 1
     * @examples [{"regex": "/reddit/", "matchThreshold": "> 3"}]
     * */
    criteria?: RepostCriteria[]
    /**
     * * If `OR` then any set of Criteria that pass will trigger the Rule
     * * If `AND` then all Criteria sets must pass to trigger the Rule
     *
     * @default "OR"
     * */
    condition?: 'AND' | 'OR'
}

export interface RepostRuleOptions extends RepostConfig, RuleOptions {
}

/**
 * Search for reposts of a Submission or Comment
 *
 * * For submissions the title or URL can searched and matched against
 * * For comments, candidate comments are gathered from similar reddit submissions and/or external sources (youtube, twitter, etc..) and then matched against
 *
 * */
export interface RepostRuleJSONConfig extends RepostConfig, RuleJSONConfig {
    /**
     * @examples ["repost"]
     * */
    kind: 'repost'
}
