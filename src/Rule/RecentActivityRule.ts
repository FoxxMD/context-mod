import {Rule, RuleJSONConfig, RuleOptions, RulePremise, RuleResult} from "./index";
import {Comment, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {activityWindowText, parseUsableLinkIdentifier} from "../util";
import {
    ActivityWindow,
    ActivityWindowCriteria,
    ActivityWindowType,
    ReferenceSubmission,
    SubredditCriteria
} from "../Common/interfaces";

const parseLink = parseUsableLinkIdentifier();

export class RecentActivityRule extends Rule {
    window: ActivityWindowType;
    thresholds: SubThreshold[];
    useSubmissionAsReference: boolean;
    lookAt?: 'comments' | 'submissions';

    constructor(options: RecentActivityRuleOptions) {
        super(options);
        const {
            window = 15,
            useSubmissionAsReference = true,
            lookAt,
        } = options || {};
        this.lookAt = lookAt;
        this.useSubmissionAsReference = useSubmissionAsReference;
        this.window = window;
        this.thresholds = options.thresholds;
    }

    getKind(): string {
        return 'Recent Activity';
    }

    getSpecificPremise(): object {
        return {
            window: this.window,
            thresholds: this.thresholds,
            useSubmissionAsReference: this.useSubmissionAsReference,
            lookAt: this.lookAt
        }
    }

    async process(item: Submission | Comment): Promise<[boolean, RuleResult[]]> {
        let activities;

        switch (this.lookAt) {
            case 'comments':
                activities = await this.resources.getAuthorComments(item.author, {window: this.window});
                break;
            case 'submissions':
                activities = await this.resources.getAuthorSubmissions(item.author, {window: this.window});
                break;
            default:
                activities = await this.resources.getAuthorActivities(item.author, {window: this.window});
                break;
        }


        let viableActivity = activities;
        if (this.useSubmissionAsReference) {
            if (!(item instanceof Submission)) {
                this.logger.warn('Cannot use post as reference because triggered item is not a Submission');
            } else if (item.is_self) {
                this.logger.warn('Cannot use post as reference because triggered Submission is not a link type');
            } else {
                const usableUrl = parseLink(await item.url);
                viableActivity = viableActivity.filter((x) => {
                    if (!(x instanceof Submission)) {
                        return false;
                    }
                    if (x.url === undefined) {
                        return false;
                    }
                    return parseLink(x.url) === usableUrl;
                });
            }
        }
        const groupedActivity = viableActivity.reduce((grouped, activity) => {
            const s = activity.subreddit.display_name.toLowerCase();
            grouped[s] = (grouped[s] || []).concat(activity);
            return grouped;
        }, {} as Record<string, (Submission | Comment)[]>);
        let triggeredPerSub = [];
        let totalTriggeredOn;
        for (const triggerSet of this.thresholds) {
            triggeredPerSub = [];
            let currCount = 0;
            let presentSubs = [];
            const {count: subCount = 1, totalCount = 1, subreddits = []} = triggerSet;
            for (const sub of subreddits) {
                const isub = sub.toLowerCase();
                const {[isub]: tSub = []} = groupedActivity;
                if(tSub.length > 0) {
                    currCount += tSub.length;
                    presentSubs.push(sub);
                    if (subCount !== undefined && tSub.length >= subCount) {
                        triggeredPerSub.push({subreddit: sub, count: tSub.length, threshold: subCount});
                    }
                }
            }
            if(totalCount !== undefined && currCount >= totalCount) {
                totalTriggeredOn = {subreddits: presentSubs, count: currCount, threshold: totalCount};
            }
            // if either trigger condition is hit end the iteration early
            if(triggeredPerSub.length > 0 || totalTriggeredOn !== undefined) {
                break;
            }
        }
        if (triggeredPerSub.length > 0 || totalTriggeredOn !== undefined) {
            let resultArr = [];
            const data: any = {};
            if(triggeredPerSub.length > 0) {
                data.perSubCount = triggeredPerSub.length;
                data.perSubTotal = triggeredPerSub.reduce((acc, x) => acc + x.count, 0);
                data.perSubSubredditsSummary = triggeredPerSub.map(x => x.subreddit).join(', ');
                data.perSubSummary = triggeredPerSub.map(x => `${x.subreddit}(${x.count})`).join(', ');
                data.perSubThreshold = triggeredPerSub[0].threshold;
                resultArr.push(`${triggeredPerSub.length} subs have >${triggeredPerSub[0].threshold} activities (${data.perSubTotal} Total)`);
            }
            if(totalTriggeredOn !== undefined) {
                data.totalCount = totalTriggeredOn.count;
                data.totalSubredditsCount = totalTriggeredOn.subreddits.length;
                data.totalSubredditsSummary = totalTriggeredOn.subreddits.join(', ')
                data.totalThreshold = totalTriggeredOn.threshold;
                data.totalSummary = `${data.totalCount} (>${totalTriggeredOn.threshold}) activities over ${totalTriggeredOn.subreddits.length} subreddits`;
                resultArr.push(data.totalSummary);
            }
            let summary;
            if(resultArr.length === 2) {
                // need a shortened summary
                summary = `${data.perSubCount} per-sub triggers (${data.perSubThreshold}) and ${data.totalCount} total (${data.totalThreshold})`
            } else {
                summary = resultArr[0];
            }
            const result = resultArr.join(' and ')
            this.logger.verbose(result);
            return Promise.resolve([true, [this.getResult(true, {
                result,
                data: {
                    window: typeof this.window === 'number' ? `${activities.length} Items` : activityWindowText(viableActivity),
                    triggeredOn: triggeredPerSub,
                    summary,
                    subSummary: data.totalSubredditsSummary|| data.perSubSubredditsSummary,
                    subCount: data.totalSubredditsCount || data.perSubCount,
                    totalCount: data.totalCount || data.perSubTotal
                }
            })]]);
        }

        return Promise.resolve([false, [this.getResult(false)]]);
    }
}

/**
 * At least one count property must be present. If both are present then either can trigger the rule
 *
 * @minProperties 1
 * @additionalProperties false
 * */
export interface SubThreshold extends SubredditCriteria {
    /**
     * The number of activities in each subreddit from the list that will trigger this rule
     * @minimum 1
     * @default 1
     * @examples [1]
     * */
    count?: number,
    /**
     * The total number of activities across all listed subreddits that will trigger this rule
     * @minimum 1
     * @default 1
     * @examples [1]
     * */
    totalCount?: number
}

interface RecentActivityConfig extends ActivityWindow, ReferenceSubmission {
    /**
     * If present restricts the activities that are considered for count from SubThreshold
     * @examples ["submissions","comments"]
     * */
    lookAt?: 'comments' | 'submissions',
    /**
     * A list of subreddits/count criteria that may trigger this rule. ANY SubThreshold will trigger this rule.
     * @minItems 1
     * */
    thresholds: SubThreshold[],
}

export interface RecentActivityRuleOptions extends RecentActivityConfig, RuleOptions {
}

/**
 * Checks a user's history for any Activity (Submission/Comment) in the subreddits specified in thresholds
 *
 * Available data for [Action templating](https://github.com/FoxxMD/reddit-context-bot#action-templating):
 *
 * ```
 * summary    => comma-deliminated list of subreddits that hit the threshold and their count EX subredditA(1), subredditB(4),...
 * subCount   => Total number of subreddits that hit the threshold
 * totalCount => Total number of all activity occurrences in subreddits
 * ```
 * */
export interface RecentActivityRuleJSONConfig extends RecentActivityConfig, RuleJSONConfig {
    /**
     * @examples ["recentActivity"]
     * */
    kind: 'recentActivity'
}

export default RecentActivityRule;
