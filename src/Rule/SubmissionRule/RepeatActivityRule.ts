import {SubmissionRule, SubmissionRuleJSONConfig} from "./index";
import {RuleOptions, RuleResult} from "../index";
import {Comment} from "snoowrap";
import {activityWindowText, parseUsableLinkIdentifier as linkParser} from "../../util";
import {ActivityWindow, ActivityWindowType, ReferenceSubmission} from "../../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import dayjs from "dayjs";

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
            identifier = activity.selftext.slice(0, length);
        } else {
            identifier = parseUsableLinkIdentifier(activity.url) as string;
        }
    } else {
        identifier = activity.body.slice(0, length);
    }
    return identifier;
}

export class RepeatActivityRule extends SubmissionRule {
    threshold: number;
    window: ActivityWindowType;
    gapAllowance?: number;
    useSubmissionAsReference: boolean;
    lookAt: 'submissions' | 'all';
    include: string[];
    exclude: string[];

    constructor(options: RepeatActivityOptions) {
        super(options);
        const {
            threshold = 5,
            window = 100,
            gapAllowance,
            useSubmissionAsReference = true,
            lookAt = 'all',
            include = [],
            exclude = []
        } = options;
        this.threshold = threshold;
        this.window = window;
        this.gapAllowance = gapAllowance;
        this.useSubmissionAsReference = useSubmissionAsReference;
        this.include = include;
        this.exclude = exclude;
        this.lookAt = lookAt;
    }

    getKind(): string {
        return 'Repeat Activity';
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

    async process(item: Submission): Promise<[boolean, RuleResult[]]> {
        const referenceUrl = await item.url;
        if (referenceUrl === undefined && this.useSubmissionAsReference) {
            this.logger.warn(`Rule not triggered because useSubmissionAsReference=true but submission is not a link`);
            return Promise.resolve([false, [this.getResult(false)]]);
        }

        let activities: (Submission | Comment)[] = [];
        switch (this.lookAt) {
            case 'submissions':
                activities = await this.resources.getAuthorSubmissions(item.author, {window: this.window});
                break;
            default:
                activities = await this.resources.getAuthorActivities(item.author, {window: this.window});
                break;
        }

        const condensedActivities = activities.reduce((acc: RepeatActivityReducer, activity: (Submission | Comment), index: number) => {
            const {openSets = [], allSets = []} = acc;

            let identifier = getActivityIdentifier(activity);

            let updatedAllSets = [...allSets];
            let updatedOpenSets = [];
            let currIdentifierInOpen = false;
            const bufferedActivities = this.gapAllowance === undefined || this.gapAllowance === 0 ? [] : activities.slice(Math.max(0, index - this.gapAllowance), Math.max(0, index));
            for (const o of openSets) {
                if (o.identifier === identifier) {
                    updatedOpenSets.push({...o, sets: [...o.sets, activity]});
                    currIdentifierInOpen = true;
                } else if (bufferedActivities.some(x => getActivityIdentifier(x) === identifier)) {
                    updatedOpenSets.push(o);
                } else {
                    updatedAllSets.push(o);
                }
            }

            if (!currIdentifierInOpen) {
                updatedOpenSets.push({identifier, sets: [activity]})
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
            const referenceSubmissions = identifierGroupedActivities.get(getActivityIdentifier(item));
            applicableGroupedActivities.set(getActivityIdentifier(item), referenceSubmissions || [])
        }

        const identifiersSummary: SummaryData[] = [];
        for (let [key, value] of applicableGroupedActivities) {
            const summaryData = {
                identifier: key,
                totalSets: value.length,
                totalTriggeringSets: 0,
                largestTrigger: 0,
                triggeringSets: [],
                triggeringSetsMarkdown: [],
            };
            for (let set of value) {
                if (set.length >= this.threshold) {
                    // @ts-ignore
                    summaryData.triggeringSets.push(set);
                    summaryData.totalTriggeringSets++;
                    summaryData.largestTrigger = Math.max(summaryData.largestTrigger, set.length);
                    const md = set.map((x: (Comment | Submission)) => `[${x instanceof Submission ? x.title : getActivityIdentifier(x, 50)}](https://reddit.com${x.permalink}) in ${x.subreddit_name_prefixed} on ${dayjs(x.created_utc * 1000).utc().format()}`);
                    // @ts-ignore
                    summaryData.triggeringSetsMarkdown.push(md);
                }
            }
            identifiersSummary.push(summaryData);
        }

        const triggeringSummaries = identifiersSummary.filter(x => x.totalTriggeringSets > 0)
        if (triggeringSummaries.length > 0) {
            const largestRepeat = triggeringSummaries.reduce((acc, summ) => Math.max(summ.largestTrigger, acc), 0);
            const result = `${triggeringSummaries.length} of ${identifiersSummary.length} unique items repeated >=${this.threshold} (threshold) times, largest repeat: ${largestRepeat}`;
            this.logger.verbose(result);
            return Promise.resolve([true, [this.getResult(true, {
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
            })]]);
        }

        return Promise.resolve([false, [this.getResult(false)]]);
    }
}

interface SummaryData {
    identifier: string,
    totalSets: number,
    totalTriggeringSets: number,
    largestTrigger: number,
    triggeringSets: (Comment | Submission)[],
    triggeringSetsMarkdown: string[]
}

interface RepeatActivityConfig extends ActivityWindow, ReferenceSubmission {
    /**
     * The number of repeat submissions that will trigger the rule
     * @default 5
     * */
    threshold?: number,
    /**
     * The number of allowed non-identical Submissions between identical Submissions that can be ignored when checking against the threshold value
     * */
    gapAllowance?: number,
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
     * If present determines which activities to consider for gapAllowance.
     *
     * * If `submissions` then only the author's submission history is considered IE gapAllowance = 2  ===> can have gap of two submissions between repeats
     * * If `all` then the author's entire history (submissions/comments) is considered IE gapAllowance = 2  ===> can only have gap of two activities (submissions or comments) between repeats
     *
     *  @default all
     * */
    lookAt?: 'submissions' | 'all',
}

export interface RepeatActivityOptions extends RepeatActivityConfig, RuleOptions {

}

/**
 * Checks a user's history for Submissions with identical content
 *
 * Available data for [Action templating](https://github.com/FoxxMD/reddit-context-bot#action-templating):
 *
 * ```
 * count      => Total number of repeat Submissions
 * threshold  => The threshold you configured for this Rule to trigger
 * url        => Url of the submission that triggered the rule
 * ```
 * */
export interface RepeatActivityJSONConfig extends RepeatActivityConfig, SubmissionRuleJSONConfig {
    kind: 'repeatActivity'
}

export default RepeatActivityRule;
