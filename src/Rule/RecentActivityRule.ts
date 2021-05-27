import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {Comment, Submission} from "snoowrap";

export class RecentActivityRule extends Rule {
    window: string | number;
    thresholds: SubThreshold[];

    constructor(options: RecentActivityRuleOptions) {
        super(options);
        this.window = options.window;
        this.thresholds = options.thresholds;
    }

    async passes(item: Submission|Comment): Promise<[boolean, Rule[]]> {
        return Promise.resolve([false, []]);
    }
}

export interface SubThreshold {
    subreddits: string[],
    count: number,
}

interface RecentActivityConfig {
    window: string | number,
    thresholds: SubThreshold[],
}

export interface RecentActivityRuleOptions extends RecentActivityConfig, RuleOptions {
}

export interface RecentActivityRuleJSONConfig extends RecentActivityConfig, RuleJSONConfig {

}

export default RecentActivityRule;
