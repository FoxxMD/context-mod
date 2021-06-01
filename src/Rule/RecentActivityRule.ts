import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {Comment, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {getAuthorActivities, getAuthorComments, getAuthorSubmissions} from "../Utils/SnoowrapUtils";
import {parseUsableLinkIdentifier} from "../util";

const parseLink = parseUsableLinkIdentifier();

export class RecentActivityRule extends Rule {
    window: string | number;
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

    getDefaultName(): string {
        return 'Recent Activity';
    }

    async run(item: Submission | Comment): Promise<[boolean, Rule[]]> {
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
            } else if (item.url === undefined) {
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
        }, {} as Record<string, (Submission | Comment)[]>)
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
            this.logger.debug(`Triggered by: ${friendlyText}`);
            return Promise.resolve([true, [this]]);
        }

        return Promise.resolve([false, [this]]);
    }
}

export interface SubThreshold {
    subreddits: string[],
    count?: number,
}

interface RecentActivityConfig {
    window?: string | number,
    usePostAsReference?: boolean,
    lookAt?: 'comments' | 'submissions',
    thresholds: SubThreshold[],
}

export interface RecentActivityRuleOptions extends RecentActivityConfig, RuleOptions {
}

export interface RecentActivityRuleJSONConfig extends RecentActivityConfig, RuleJSONConfig {

}

export default RecentActivityRule;
