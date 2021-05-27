import {ISubmissionRule, SubmissionRule, SubmissionRuleJSONConfig} from "./index";
import {IRule, Rule, RuleOptions} from "../index";
import {Comment, Submission} from "snoowrap";

export class RepeatSubmissionRule extends SubmissionRule {
    threshold: number;
    window: string | number;
    gapAllowance: number;
    include: string[];
    exclude: string[];

    constructor(options: RepeatSubmissionOptions) {
        super(options);
        const {
            threshold = 5,
            window = 15,
            gapAllowance = 2,
            include = [],
            exclude = []
        } = options;
        this.threshold = threshold;
        this.window = window;
        this.gapAllowance = gapAllowance;
        this.include = include;
        this.exclude = exclude;
    }

    async passes(item: Submission|Comment): Promise<[boolean, Rule[]]> {
        return Promise.resolve([false, []]);
    }
}

interface RepeatSubmissionConfig {
    threshold: number,
    window?: string | number,
    gapAllowance?: number,
    include?: string[],
    exclude?: string[],
}

export interface RepeatSubmissionOptions extends RepeatSubmissionConfig, RuleOptions {

}

export interface RepeatSubmissionJSONConfig extends RepeatSubmissionConfig, SubmissionRuleJSONConfig {

}

export default RepeatSubmissionRule;
