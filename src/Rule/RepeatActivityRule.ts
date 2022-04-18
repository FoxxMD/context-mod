import {Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import {Comment, RedditUser} from "snoowrap";
import {
    activityWindowText,
    asSubmission,
    comparisonTextOp,
    FAIL,
    getActivitySubredditName,
    isExternalUrlSubmission,
    isRedditMedia,
    parseGenericValueComparison,
    parseSubredditName,
    parseUsableLinkIdentifier as linkParser,
    PASS,
    searchAndReplace,
    stringSameness,
    subredditStateIsNameOnly,
    toStrongSubredditState
} from "../util";
import {
    ActivityWindow,
    ActivityWindowType,
    ReferenceSubmission, SearchAndReplaceRegExp,
    StrongSubredditState,
    SubredditState, TextMatchOptions, TextTransformOptions
} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import dayjs from "dayjs";
import Fuse from 'fuse.js'

const parseUsableLinkIdentifier = linkParser();

interface RepeatActivityData {
    identifier: string,
    sets: (Submission | Comment)[]
}

interface RepeatActivityReducer {
    openSets: RepeatActivityData[]
    allSets: RepeatActivityData[]
}

export class RepeatActivityRule extends Rule {
    threshold: string;
    window: ActivityWindowType;
    gapAllowance?: number;
    useSubmissionAsReference: boolean;
    lookAt: 'submissions' | 'all';
    include: (string | SubredditState)[];
    exclude: (string | SubredditState)[];
    hasFullSubredditCrits: boolean = false;
    activityFilterFunc: (x: Submission|Comment, author: RedditUser) => Promise<boolean> = async (x) => true;
    keepRemoved: boolean;
    minWordCount: number;
    transformations: SearchAndReplaceRegExp[]
    caseSensitive: boolean
    matchScore: number

    constructor(options: RepeatActivityOptions) {
        super(options);
        const {
            threshold = '> 5',
            window = 100,
            gapAllowance,
            useSubmissionAsReference = true,
            minWordCount = 1,
            lookAt = 'all',
            include = [],
            exclude = [],
            keepRemoved = false,
            transformations = [],
            caseSensitive = true,
            matchScore = 85,
        } = options;
        this.matchScore = matchScore;
        this.transformations = transformations;
        this.caseSensitive = caseSensitive;
        this.minWordCount = minWordCount;
        this.keepRemoved = keepRemoved;
        this.threshold = threshold;
        this.window = window;
        this.gapAllowance = gapAllowance;
        this.useSubmissionAsReference = useSubmissionAsReference;
        this.include = include;
        this.exclude = exclude;

        if(this.include.length > 0) {
            const subStates = include.map((x) => {
                if(typeof x === 'string') {
                    return toStrongSubredditState({name: x, stateDescription: x}, {defaultFlags: 'i', generateDescription: true});
                }
                return toStrongSubredditState(x, {defaultFlags: 'i', generateDescription: true});
            });
            this.hasFullSubredditCrits = !subStates.every(x => subredditStateIsNameOnly(x));
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
            this.hasFullSubredditCrits = !subStates.every(x => subredditStateIsNameOnly(x));
            this.activityFilterFunc = async (x: Submission|Comment, author: RedditUser) => {
                for(const ss of subStates) {
                    if(await this.resources.testSubredditCriteria(x, ss, author)) {
                        return false;
                    }
                }
                return true;
            };
        }
        this.lookAt = lookAt;
    }

    getKind(): string {
        return 'Repeat';
    }

    getSpecificPremise(): object {
        return {
            threshold: this.threshold,
            window: this.window,
            gapAllowance: this.gapAllowance,
            useSubmissionAsReference: this.useSubmissionAsReference,
            include: this.include,
            exclude: this.exclude,
        }
    }

    // TODO unify matching logic with recent and repost rules
    getActivityIdentifier(activity: (Submission | Comment), length = 200, transform = true) {
        let identifier: string;
        if (asSubmission(activity)) {
            if (activity.is_self) {
                identifier = `${activity.title}${activity.selftext.slice(0, length)}`;
            } else if(isRedditMedia(activity)) {
                identifier = activity.title;
            } else {
                identifier = parseUsableLinkIdentifier(activity.url) as string;
            }
        } else {
            identifier = activity.body.slice(0, length);
        }

        if(!transform) {
            return identifier;
        }

        // apply any transforms
        if (this.transformations.length > 0) {
            identifier = searchAndReplace(identifier, this.transformations);
        }

        // perform after transformations so as not to mess up regex's depending on case
        if(!this.caseSensitive) {
            identifier = identifier.toLowerCase();
        }

        return identifier;
    }

    async process(item: Submission|Comment): Promise<[boolean, RuleResult]> {
        let referenceUrl;
        if(asSubmission(item) && this.useSubmissionAsReference) {
            referenceUrl = await item.url;
        }

        let activities: (Submission | Comment)[] = [];
        switch (this.lookAt) {
            case 'submissions':
                activities = await this.resources.getAuthorSubmissions(item.author, {window: this.window, keepRemoved: this.keepRemoved});
                break;
            default:
                activities = await this.resources.getAuthorActivities(item.author, {window: this.window, keepRemoved: this.keepRemoved});
                break;
        }

        if(this.hasFullSubredditCrits) {
            // go ahead and cache subreddits now
            // because we can't use batch test since testing activities in order is important for this rule
            await this.resources.cacheSubreddits(activities.map(x => x.subreddit));
        }

        const condensedActivities = await activities.reduce(async (accProm: Promise<RepeatActivityReducer>, activity: (Submission | Comment), index: number) => {
            const acc = await accProm;
            const {openSets = [], allSets = []} = acc;

            let identifier = this.getActivityIdentifier(activity);

            const isUrl = isExternalUrlSubmission(activity);
            //let fu = new Fuse([identifier], !isUrl ? fuzzyOptions : {...fuzzyOptions, distance: 5});
            const validSub = await this.activityFilterFunc(activity, item.author);
            let minMet = identifier.length >= this.minWordCount;

            let updatedAllSets = [...allSets];
            let updatedOpenSets: RepeatActivityData[] = [];

            let currIdentifierInOpen = false;
            const bufferedActivities = this.gapAllowance === undefined || this.gapAllowance === 0 ? [] : activities.slice(Math.max(0, index - this.gapAllowance), Math.max(0, index));
            for (const o of openSets) {
                const strMatchResults = stringSameness(o.identifier, identifier);
                if (strMatchResults.highScoreWeighted >= this.matchScore && minMet) {
                    updatedOpenSets.push({...o, sets: [...o.sets, activity]});
                    currIdentifierInOpen = true;
                } else if (bufferedActivities.some(x => {
                    let buffIdentifier = this.getActivityIdentifier(x);
                    const buffMatch = stringSameness(identifier, buffIdentifier);
                    return buffMatch.highScoreWeighted >= this.matchScore;
                }) && validSub && minMet) {
                    updatedOpenSets.push(o);
                } else if(!currIdentifierInOpen && !isUrl) {
                    updatedAllSets.push(o);
                }
            }

            if (!currIdentifierInOpen) {
                updatedOpenSets.push({identifier, sets: [activity]})

                if(isUrl) {
                    // could be that a spammer is using different URLs for each submission but similar submission titles so search by title as well
                    const sub = activity as Submission;
                    identifier = sub.title;
                    //fu = new Fuse([identifier], !isUrl ? fuzzyOptions : {...fuzzyOptions, distance: 5});
                    minMet = identifier.length >= this.minWordCount;
                    for (const o of openSets) {
                        const strMatchResults = stringSameness(o.identifier, identifier);
                        if (strMatchResults.highScoreWeighted >= this.matchScore && minMet) {
                            updatedOpenSets.push({...o, sets: [...o.sets, activity]});
                            currIdentifierInOpen = true;
                        } else if (bufferedActivities.some(x => {
                            let buffIdentifier = this.getActivityIdentifier(x);
                            const buffMatch = stringSameness(identifier, buffIdentifier);
                            return buffMatch.highScoreWeighted >= this.matchScore;
                        }) && validSub && minMet && !updatedOpenSets.includes(o)) {
                            updatedOpenSets.push(o);
                        } else if(!updatedAllSets.includes(o)) {
                            updatedAllSets.push(o);
                        }
                    }

                    if (!currIdentifierInOpen) {
                        updatedOpenSets.push({identifier, sets: [activity]})
                    }
                }
            }

            return {openSets: updatedOpenSets, allSets: updatedAllSets};

        }, Promise.resolve({openSets: [], allSets: []}));

        const allRepeatSets = [...condensedActivities.allSets, ...condensedActivities.openSets];

        const identifierGroupedActivities = allRepeatSets.reduce((acc, repeatActivityData) => {
            let existingSets = [];
            if (acc.has(repeatActivityData.identifier)) {
                existingSets = acc.get(repeatActivityData.identifier);
            }
            acc.set(repeatActivityData.identifier, [...existingSets, repeatActivityData.sets].sort((a, b) => b.length < a.length ? 1 : -1));
            return acc;
        }, new Map());

        let applicableGroupedActivities = identifierGroupedActivities;
        if (this.useSubmissionAsReference) {
            applicableGroupedActivities = new Map();
            let identifier = this.getActivityIdentifier(item);
            // look for exact match first
            let referenceSubmissions = identifierGroupedActivities.get(identifier);
            if(referenceSubmissions === undefined) {
                if(isExternalUrlSubmission(item)) {
                    // if external url sub then try by title
                    identifier = (item as Submission).title;
                    referenceSubmissions = identifierGroupedActivities.get(identifier);
                    if(referenceSubmissions === undefined) {
                        // didn't get by title so go back to url since that's the default
                        identifier = this.getActivityIdentifier(item);
                    }
                } else if(asSubmission(item) && item.is_self) {
                    // if is self post then identifier is made up of title and body so identifiers may not be *exact* if title varies or body varies
                    // -- try to find identifying sets by using string sameness on set identifiers
                    let fuzzySets: (Submission | Comment)[] = [];
                    for(const [k, v] of identifierGroupedActivities.entries()) {
                        const strMatchResults = stringSameness(k, identifier);
                        if (strMatchResults.highScoreWeighted >= this.matchScore) {
                            fuzzySets = fuzzySets.concat(v);
                        }
                    }
                    referenceSubmissions = [fuzzySets.flat()];
                }
            }

            applicableGroupedActivities.set(identifier, referenceSubmissions || [])
        }

        const {operator, value: thresholdValue} = parseGenericValueComparison(this.threshold);
        const greaterThan = operator.includes('>');
        let allLessThan = true;

        const identifiersSummary: SummaryData[] = [];
        for (let [key, value] of applicableGroupedActivities) {
            const summaryData: SummaryData = {
                identifier: key,
                totalSets: value.length,
                totalTriggeringSets: 0,
                largestTrigger: 0,
                sets: [],
                setsMarkdown: [],
                triggeringSets: [],
                triggeringSetsMarkdown: [],
            };
            for (let set of value) {
                const test = comparisonTextOp(set.length, operator, thresholdValue);
                const md = set.map((x: (Comment | Submission)) => `[${asSubmission(x) ? x.title : this.getActivityIdentifier(x, 50)}](https://reddit.com${x.permalink}) in ${x.subreddit_name_prefixed} on ${dayjs(x.created_utc * 1000).utc().format()}`);

                summaryData.sets.push(set);
                summaryData.largestTrigger = Math.max(summaryData.largestTrigger, set.length);
                summaryData.setsMarkdown.push(md);
                if (test) {
                    summaryData.triggeringSets.push(set);
                    summaryData.totalTriggeringSets++;
                    summaryData.triggeringSetsMarkdown.push(md);
                    // }
                } else if (!greaterThan) {
                    allLessThan = false;
                }
            }
            identifiersSummary.push(summaryData);
        }

        const criteriaMet = identifiersSummary.filter(x => x.totalTriggeringSets > 0).length > 0 && (greaterThan || (!greaterThan && allLessThan));

        const largestRepeat = identifiersSummary.reduce((acc, summ) => Math.max(summ.largestTrigger, acc), 0);
        let result: string;
        if (criteriaMet || greaterThan) {
            result = `${criteriaMet ? PASS : FAIL} ${identifiersSummary.filter(x => x.totalTriggeringSets > 0).length} of ${identifiersSummary.length} unique items repeated ${this.threshold} times, largest repeat: ${largestRepeat}`;
        } else {
            result = `${FAIL} Not all of ${identifiersSummary.length} unique items repeated ${this.threshold} times, largest repeat: ${largestRepeat}`
        }

        this.logger.verbose(result);

        if (criteriaMet) {
            const triggeringSummaries = identifiersSummary.filter(x => x.totalTriggeringSets > 0);
            return Promise.resolve([true, this.getResult(true, {
                result,
                data: {
                    window: typeof this.window === 'number' ? `${activities.length} Items` : activityWindowText(activities),
                    totalTriggeringSets: triggeringSummaries.length,
                    largestRepeat,
                    threshold: this.threshold,
                    gapAllowance: this.gapAllowance,
                    url: referenceUrl,
                    triggeringSummaries,
                }
            })])
        }

        return Promise.resolve([false, this.getResult(false, {result})]);
    }
}

interface SummaryData {
    identifier: string,
    totalSets: number,
    totalTriggeringSets: number,
    largestTrigger: number,
    sets: (Comment | Submission)[],
    setsMarkdown: string[],
    triggeringSets: (Comment | Submission)[],
    triggeringSetsMarkdown: string[]
}

interface RepeatActivityConfig extends ActivityWindow, ReferenceSubmission, TextMatchOptions {
    /**
     * The number of repeat submissions that will trigger the rule
     * @default ">= 5"
     * */
    threshold?: string,
    /**
     * The number of allowed non-identical Submissions between identical Submissions that can be ignored when checking against the threshold value
     * */
    gapAllowance?: number,
    /**
     * If present, activities will be counted only if they are found in this list of Subreddits
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
     * @examples [["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]]
     * */
    exclude?: (string | SubredditState)[],

    /**
     * If present determines which activities to consider for gapAllowance.
     *
     * * If `submissions` then only the author's submission history is considered IE gapAllowance = 2  ===> can have gap of two submissions between repeats
     * * If `all` then the author's entire history (submissions/comments) is considered IE gapAllowance = 2  ===> can only have gap of two activities (submissions or comments) between repeats
     *
     *  @default all
     * */
    lookAt?: 'submissions' | 'all',
    /**
     * Count submissions/comments that have previously been removed.
     *
     * By default all `Submissions/Commments` that are in a `removed` state will be filtered from `window` (only applies to subreddits you mod).
     *
     * Setting to `true` could be useful if you also want to also detected removed repeat posts by a user like for example if automoderator removes multiple, consecutive submissions for not following title format correctly.
     *
     * @default false
     * */
    keepRemoved?: boolean

    /**
     * A set of search-and-replace operations to perform on text values before performing a match. Transformations are performed in the order they are defined.
     * */
    transformations?: SearchAndReplaceRegExp[]
}

export interface RepeatActivityOptions extends RepeatActivityConfig, RuleOptions {

}

/**
 * Checks a user's history for Submissions with identical content
 *
 * Available data for [Action templating](https://github.com/FoxxMD/context-mod#action-templating):
 *
 * ```
 * count      => Total number of repeat Submissions
 * threshold  => The threshold you configured for this Rule to trigger
 * url        => Url of the submission that triggered the rule
 * ```
 * */
export interface RepeatActivityJSONConfig extends RepeatActivityConfig, RuleJSONConfig {
    kind: 'repeatActivity'
}

export default RepeatActivityRule;
