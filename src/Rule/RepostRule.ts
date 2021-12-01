import {Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import {Listing, SearchOptions} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {
    parseUsableLinkIdentifier,
    PASS, searchAndReplace, triggeredIndicator, windowToActivityWindowCriteria
} from "../util";
import {
    ActivityWindow,
    ActivityWindowType, JoinOperands, RepostItem, SearchAndReplaceRegExp,
} from "../Common/interfaces";
import objectHash from "object-hash";
import {getActivities, getAttributionIdentifier} from "../Utils/SnoowrapUtils";
import Fuse from "fuse.js";
import leven from "leven";
import {YoutubeClient, commentsAsRepostItems} from "../Utils/ThirdParty/YoutubeClient";

const parseYtIdentifier = parseUsableLinkIdentifier();

export interface TextMatchOptions {
    /**
     * The distance, from the expected location, a character can be found and still be considered a match
     *
     * Defaults to 15. Learn more about fuzziness score https://fusejs.io/concepts/scoring-theory.html#fuzziness-score
     *
     * @default 15
     * @example [15]
     * */
    matchDistance?: number
    /**
     * The percentage, as a whole number, of a repost title/comment that must match the title/comment being checked in order to consider both a match
     *
     * Note: Setting to 0 will make every candidate considered a match -- useful if you want to match if the URL has been reposted anywhere
     *
     * Defaults to `85` (85%)
     *
     * @default 85
     * @example [85]
     * */
    matchScore?: number

    /**
     * The minimum number of words in the activity being checked for which this rule will run on
     *
     * If the word count is below the minimum the rule fails
     *
     * Defaults to 2
     *
     * @default 2
     * @example [2]
     * */
    minWordCount?: number

    /**
     * Should text matching be case sensitive?
     *
     * Defaults to false
     *
     * @default false
     * @example [false]
     **/
    caseSensitive?: boolean
}

export interface TextTransformOptions {
    /**
     * A set of search-and-replace operations to perform on text values before performing a match. Transformations are performed in the order they are defined.
     *
     * * If `transformationsActivity` IS NOT defined then these transformations will be performed on BOTH the activity text (submission title or comment) AND the repost candidate text
     * * If `transformationsActivity` IS defined then these transformations are only performed on repost candidate text
     * */
    transformations?: SearchAndReplaceRegExp[]

    /**
     * Specify a separate set of transformations for the activity text (submission title or comment)
     *
     * To perform no transformations when `transformations` is defined set this to an empty array (`[]`)
     * */
    transformationsActivity?: SearchAndReplaceRegExp[]
}

export type SearchFacetType = 'title' | 'url' | 'duplicates' | 'crossposts' | 'external';

export interface SearchFacetJSONConfig extends TextMatchOptions, TextTransformOptions, ActivityWindow {
    kind: SearchFacetType | SearchFacetType[]
}

export interface SearchFacet extends SearchFacetJSONConfig {
    kind: SearchFacetType
}

/**
 * A set of criteria used to find reposts
 *
 * Contains options and conditions used to define how candidate reposts are retrieved and if they are a match.
 *
 * */
export interface RepostCriteria extends ActivityWindow {
    /**
     * Define how to find candidate reposts
     *
     * * **title** -- search reddit for submissions with the same title
     * * **url** -- search reddit for submissions with the same url
     * * **external** -- WHEN ACTIVITY IS A COMMENT - tries to get comments from external source (youtube, twitter, etc...)
     * */
    searchOn?: (SearchFacetType | SearchFacetJSONConfig)[]

    criteria?: TextMatchOptions & TextTransformOptions

    maxRedditItems?: number

    maxExternalItems?: number

    /**
     * The maximum number of comments/replies/items to retrieve from an external source.
     *
     * Note: External items, where possible, are returned/sorted in order of popularity (likes, replies, etc...) so if you are looking for reposts of popular items the default max items retrieved will mostly contain all relevant items.
     *
     * Defaults to 20
     *
     * @default 20
     * @example [20]
     * */
    externalItemCount?: number
}

const parentSubmissionSearchFacetDefaults = {
    title: {
        matchDistance: 15,
        matchScore: 85,
        minWordCount: 2
    },
    url: {
        matchDistance: 15,
        matchScore: 0, // when looking for submissions to find repost comments on automatically include any with exact same url
    },
    duplicates: {
        matchDistance: 15,
        matchScore: 0, // when looking for submissions to find repost comments on automatically include any that reddit thinks are duplicates
    },
    crossposts: {
        matchDistance: 15,
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

const generateSearchFacet = (val: SearchFacetType | SearchFacetJSONConfig, sourceActivity: (Submission | Comment)): SearchFacet[] => {
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

    const sourceIsComm = sourceActivity instanceof Comment;

    return facets.map(x => {
        if (sourceIsComm) {
            return {
                ...parentSubmissionSearchFacetDefaults[x.kind],
                ...x,
            }
        }
        return {
            matchDistance: 15,
            matchScore: 0,
            ...x,
        }
    });
}

interface CriteriaResult {
    match: RepostItem,
    score: number
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
        const criteriaMatchedResults: CriteriaResult[] = [];

        for (const rCriteria of this.criteria) {
            const {
                searchOn = (item instanceof Submission ? ['title', 'url', 'duplicates', 'crossposts'] : ['external', 'title', 'url', 'duplicates', 'crossposts']),
                criteria = {},
                externalItemCount = 20,
                maxRedditItems = 20,
                maxExternalItems = 20,
                window = 20,
            } = rCriteria;

            const searchFacets = searchOn.map(x => generateSearchFacet(x, item)).flat(1) as SearchFacet[];

            const includeCrossposts = searchFacets.some(x => x.kind === 'crossposts');

            // in getDuplicate() options add "crossposts_only=1" to get only crossposts https://www.reddit.com/r/redditdev/comments/b4t5g4/get_all_the_subreddits_that_a_post_has_been/
            // if a submission is a crosspost it has "crosspost_parent" attribute https://www.reddit.com/r/redditdev/comments/l46y2l/check_if_post_is_a_crosspost/

            const strongWindow = windowToActivityWindowCriteria(window);

            const candidateHash = `repostItems-${item instanceof Submission ? item.id : item.link_id}-${objectHash.sha1({
                window,
                searchOn
            })}`;
            let items: RepostItem[] = [];
            let cacheRes = undefined;
            if (item instanceof Comment) {
                //cacheRes = await this.resources.cache.get(candidateHash) as (RepostItem[] | undefined | null);
            }

            if (cacheRes === undefined || cacheRes === null) {
                let sourceSubmissions: Submission[] = [];

                const sub = await this.getSubmission(item);
                let dups: (Submission[] | undefined) = undefined;

                for (const sf of searchFacets) {

                    const {
                        matchDistance = 15,
                        matchScore = 85,
                        minWordCount = 2,
                        caseSensitive = false,
                        transformations = [],
                        transformationsActivity = transformations,
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
                                items = items.concat(commentsAsRepostItems(await ytClient.getVideoTopComments(sub.url, maxExternalItems)))
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

                        if (matchScore === 0) {
                            sourceSubmissions = sourceSubmissions.concat(subs);
                        } else {
                            let sourceTitle = searchAndReplace(sub.title, transformationsActivity);
                            if (!caseSensitive) {
                                sourceTitle = sourceTitle.toLowerCase();
                            }
                            sourceSubmissions = sourceSubmissions.concat(subs.filter(x => {

                                let cleanTitle = searchAndReplace(x.title, transformations);
                                if (!caseSensitive) {
                                    cleanTitle = cleanTitle.toLowerCase();
                                }
                                const distance = leven(sourceTitle, cleanTitle);
                                const diff = (distance / sourceTitle.length) * 100;
                                if(diff < 100 - matchScore) {
                                }
                                return diff < 100 - matchScore;
                            }));
                        }

                    }
                }

                // make submissions unique and remove own
                sourceSubmissions = sourceSubmissions.reduce((acc: Submission[], curr) => {
                    if (!acc.some(x => x.id === curr.id)) {
                        return acc.concat(curr);
                    }
                    return acc;
                }, []).filter(x => x.id !== sub.id);

                if (!includeCrossposts) {
                    const sub = await this.getSubmission(item);
                    // remove submissions if they are official crossposts of the submission being checked and searchOn did not include 'crossposts'
                    // @ts-ignore
                    sourceSubmissions = sourceSubmissions.filter(x => !(x.crosspost_parent !== undefined && x.crosspost_parent === sub.id));
                }


                if (item instanceof Submission) {
                    // get titles
                    items = items.concat(sourceSubmissions.slice(0, maxRedditItems).map(x => ({
                        value: searchAndReplace(x.title, criteria.transformations ?? []),
                        createdOn: x.created,
                        source: 'reddit',
                        sourceUrl: x.permalink,
                        score: x.score,
                    })));
                } else {
                    // otherwise we are gathering comments

                    // first cut down the number of submissions to retrieve because we don't care about have ALL submissions,
                    // just most popular comments (which will be in the most popular submissions)
                    sourceSubmissions.sort((a, b) => a.score - b.score).reverse();
                    // take top 10 submissions
                    sourceSubmissions = sourceSubmissions.slice(0, 10);

                    let comments: Comment[] = [];
                    for (const sub of sourceSubmissions) {

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

                    // and take the user-defined maximum number of items
                    items = items.concat(comments.slice(0, maxRedditItems).map(x => ({
                        value: searchAndReplace(x.body, criteria.transformations ?? []),
                        createdOn: x.created,
                        source: 'reddit',
                        sourceUrl: x.permalink,
                        score: x.score
                    })));
                }

                if (item instanceof Comment) {
                    // cache items for 20 minutes
                    await this.resources.cache.set(candidateHash, items, {ttl: 1200});
                }
            } else {
                items = cacheRes;
            }

            if(item instanceof Submission) {
                // we've already done difference calculations in the searchFacet phase
                // and when the check is for a sub it means we are only checking if the submissions has been reposted which means either:
                // * very similar title (default sameness of 85% or more)
                // * duplicate/same URL -- which is a repost, duh
                // so just add all items to critMatches at this point
            }

            const {
                matchDistance = 15,
                matchScore = 85,
                minWordCount = 2,
                caseSensitive = false,
                transformations = [],
                transformationsActivity = transformations,
            } = criteria;

            let sourceContent = searchAndReplace(item instanceof Submission ? item.title : item.body, transformationsActivity);
            if (!caseSensitive) {
                sourceContent = sourceContent.toLowerCase();
            }


            for (const i of items) {
                const itemContent = !caseSensitive ? i.value.toLowerCase() : i.value;
                const distance = leven(sourceContent, itemContent);
                const diff = (distance / sourceContent.length) * 100;
                if (diff < 100 - matchScore) {
                    criteriaMatchedResults.push({match: i, score: diff});
                }
            }
            if (criteriaMatchedResults.length === 0 && this.condition === 'AND') {
                return [false, this.getResult(false, {data: criteriaResults, result: 'Not all criteria matched'})];
            }
            if (criteriaMatchedResults.length > 0) {
                criteriaResults = criteriaResults.concat(criteriaMatchedResults);
                if (this.condition === 'OR') {
                    break;
                }
            }
        }
        const foundRepost = criteriaResults.length > 0;

        return [foundRepost, this.getResult(foundRepost, {
            result: foundRepost ? 'Found a repost' : 'no reposts found',
            data: criteriaResults
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
