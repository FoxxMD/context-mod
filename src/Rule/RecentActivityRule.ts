import {Rule, RuleJSONConfig, RuleOptions, RulePremise, RuleResult} from "./index";
import {Comment, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {getAuthorActivities, getAuthorComments, getAuthorSubmissions} from "../Utils/SnoowrapUtils";
import {parseUsableLinkIdentifier} from "../util";
import {ActivityWindow, ActivityWindowCriteria, ActivityWindowType} from "../Common/interfaces";

const parseLink = parseUsableLinkIdentifier();

export class RecentActivityRule extends Rule {
    window: ActivityWindowType;
    thresholds: SubThreshold[];
    usePostAsReference: boolean;
    lookAt?: 'comments' | 'submissions';

    constructor(options: RecentActivityRuleOptions) {
        super(options);
        const {
            window = 15,
            usePostAsReference = true,
            lookAt,
        } = options || {};
        this.lookAt = lookAt;
        this.usePostAsReference = usePostAsReference;
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
            usePostAsReference: this.usePostAsReference,
            lookAt: this.lookAt
        }
    }

    async process(item: Submission | Comment): Promise<[boolean, RuleResult[]]> {
        let activities;

        switch (this.lookAt) {
            case 'comments':
                activities = await getAuthorComments(item.author, {window: this.window});
                break;
            case 'submissions':
                activities = await getAuthorSubmissions(item.author, {window: this.window});
                break;
            default:
                activities = await getAuthorActivities(item.author, {window: this.window});
                break;
        }


        let viableActivity = activities;
        if (this.usePostAsReference) {
            if (!(item instanceof Submission)) {
                this.logger.debug('Cannot use post as reference because triggered item is not a Submission');
            } else if (item.is_self) {
                this.logger.debug('Cannot use post as reference because triggered Submission is not a link type');
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
        const triggeredOn = [];
        for (const triggerSet of this.thresholds) {
            const {count: threshold = 1, subreddits = []} = triggerSet;
            for (const sub of subreddits) {
                const isub = sub.toLowerCase();
                const {[isub]: tSub = []} = groupedActivity;
                if (tSub.length >= threshold) {
                    triggeredOn.push({subreddit: sub, count: tSub.length});
                }
            }
        }
        if (triggeredOn.length > 0) {
            const friendlyText = triggeredOn.map(x => `${x.subreddit}(${x.count})`).join(' | ');
            const friendly = `Triggered by: ${friendlyText}`;
            this.logger.debug(friendly);
            return Promise.resolve([true, [this.getResult(true, {result: friendly, data: triggeredOn})]]);
        }

        return Promise.resolve([false, [this.getResult(false)]]);
    }
}

export interface SubThreshold {
    /**
     * A list of subreddits (case-insensitive) to look for
     * @minItems 1
     * */
    subreddits: string[],
    /**
     * The number of activities in each subreddit from the list that will trigger this rule
     * */
    count?: number,
}

interface RecentActivityConfig extends ActivityWindow {
    /**
     * If activity is a Submission and is a link (not self-post) then only look at Submissions that contain this link, otherwise consider all activities.
     * */
    usePostAsReference?: boolean,
    /**
     * If present restricts the activities that are considered for count from SubThreshold
     * */
    lookAt?: 'comments' | 'submissions',
    /**
     * A list of subreddits/count criteria that may trigger this rule. ANY SubThreshold will trigger this rule.
     * */
    thresholds: SubThreshold[],

    /**
     * @default 15
     * */
    window: ActivityWindowType;
}

export interface RecentActivityRuleOptions extends RecentActivityConfig, RuleOptions {
}

export interface RecentActivityRuleJSONConfig extends RecentActivityConfig, RuleJSONConfig {

}

export default RecentActivityRule;
