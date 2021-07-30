import {Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import {Comment} from "snoowrap";
import {
    activityWindowText,
    comparisonTextOp, FAIL, isExternalUrlSubmission, isRedditMedia,
    parseGenericValueComparison, parseSubredditName,
    parseUsableLinkIdentifier as linkParser, PASS
} from "../util";
import {ActivityWindow, ActivityWindowType, ReferenceSubmission} from "../Common/interfaces";
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

const getActivityIdentifier = (activity: (Submission | Comment), length = 200) => {
    let identifier: string;
    if (activity instanceof Submission) {
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
    return identifier;
}

const fuzzyOptions = {
    includeScore: true,
    distance: 15
};

export class RepeatActivityRule extends Rule {
    threshold: string;
    window: ActivityWindowType;
    gapAllowance?: number;
    useSubmissionAsReference: boolean;
    lookAt: 'submissions' | 'all';
    include: string[];
    exclude: string[];
    keepRemoved: boolean;
    minWordCount: number;

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
        } = options;
        this.minWordCount = minWordCount;
        this.keepRemoved = keepRemoved;
        this.threshold = threshold;
        this.window = window;
        this.gapAllowance = gapAllowance;
        this.useSubmissionAsReference = useSubmissionAsReference;
        this.include = include.map(x => parseSubredditName(x).toLowerCase());
        this.exclude = exclude.map(x => parseSubredditName(x).toLowerCase());
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

    async process(item: Submission|Comment): Promise<[boolean, RuleResult]> {
        let referenceUrl;
        if(item instanceof Submission && this.useSubmissionAsReference) {
            referenceUrl = await item.url;
        }

        let filterFunc = (x: any) => true;
        if(this.include.length > 0) {
            filterFunc = (x: Submission|Comment) => this.include.includes(x.subreddit.display_name.toLowerCase());
        } else if(this.exclude.length > 0) {
            filterFunc = (x: Submission|Comment) => !this.exclude.includes(x.subreddit.display_name.toLowerCase());
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

        const condensedActivities = activities.reduce((acc: RepeatActivityReducer, activity: (Submission | Comment), index: number) => {
            const {openSets = [], allSets = []} = acc;

            let identifier = getActivityIdentifier(activity);
            const isUrl = isExternalUrlSubmission(activity);
            let fu = new Fuse([identifier], !isUrl ? fuzzyOptions : {...fuzzyOptions, distance: 5});
            const validSub = filterFunc(activity);
            let minMet = identifier.length >= this.minWordCount;

            let updatedAllSets = [...allSets];
            let updatedOpenSets: RepeatActivityData[] = [];

            let currIdentifierInOpen = false;
            const bufferedActivities = this.gapAllowance === undefined || this.gapAllowance === 0 ? [] : activities.slice(Math.max(0, index - this.gapAllowance), Math.max(0, index));
            for (const o of openSets) {
                const res = fu.search(o.identifier);
                const match = res.length > 0;
                if (match && validSub && minMet) {
                    updatedOpenSets.push({...o, sets: [...o.sets, activity]});
                    currIdentifierInOpen = true;
                } else if (bufferedActivities.some(x => fu.search(getActivityIdentifier(x)).length > 0) && validSub && minMet) {
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
                    fu = new Fuse([identifier], !isUrl ? fuzzyOptions : {...fuzzyOptions, distance: 5});
                    minMet = identifier.length >= this.minWordCount;
                    for (const o of openSets) {
                        const res = fu.search(o.identifier);
                        const match = res.length > 0;
                        if (match && validSub && minMet) {
                            updatedOpenSets.push({...o, sets: [...o.sets, activity]});
                            currIdentifierInOpen = true;
                        } else if (bufferedActivities.some(x => fu.search(getActivityIdentifier(x)).length > 0) && validSub && minMet && !updatedOpenSets.includes(o)) {
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

        }, {openSets: [], allSets: []});

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
            let identifier = getActivityIdentifier(item);
            let referenceSubmissions = identifierGroupedActivities.get(identifier);
            if(referenceSubmissions === undefined && isExternalUrlSubmission(item)) {
                // if external url sub then try by title
                identifier = (item as Submission).title;
                referenceSubmissions = identifierGroupedActivities.get(identifier);
                if(referenceSubmissions === undefined) {
                    // didn't get by title so go back to url since that's the default
                    identifier = getActivityIdentifier(item);
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
                const md = set.map((x: (Comment | Submission)) => `[${x instanceof Submission ? x.title : getActivityIdentifier(x, 50)}](https://reddit.com${x.permalink}) in ${x.subreddit_name_prefixed} on ${dayjs(x.created_utc * 1000).utc().format()}`);

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

interface RepeatActivityConfig extends ActivityWindow, ReferenceSubmission {
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
     * Only include Submissions from this list of Subreddits (by name, case-insensitive)
     *
     * EX `["mealtimevideos","askscience"]`
     * @examples ["mealtimevideos","askscience"]
     * @minItems 1
     * */
    include?: string[],
    /**
     * Do not include Submissions from this list of Subreddits (by name, case-insensitive)
     *
     * EX `["mealtimevideos","askscience"]`
     * @examples ["mealtimevideos","askscience"]
     * @minItems 1
     * */
    exclude?: string[],

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
     * For activities that are text-based this is the minimum number of words required for the activity to be considered for a repeat
     *
     * EX if `minimumWordCount=5` and a comment is `what about you` then it is ignored because `3 is less than 5`
     *
     * **For self-text submissions** -- title + body text
     *
     * **For comments* -- body text
     *
     * @default 1
     * @example [1]
     * */
    minWordCount?: number,
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
