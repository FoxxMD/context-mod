import {SubmissionRule, SubmissionRuleJSONConfig} from "./index";
import {Rule, RuleOptions, RulePremise, RuleResult} from "../index";
import {Submission} from "snoowrap";
import {getAuthorSubmissions} from "../../Utils/SnoowrapUtils";
import {groupBy, parseUsableLinkIdentifier as linkParser} from "../../util";

const groupByUrl = groupBy(['urlIdentifier']);
const parseUsableLinkIdentifier = linkParser()

export class RepeatSubmissionRule extends SubmissionRule {
    threshold: number;
    window: string | number;
    gapAllowance?: number;
    usePostAsReference: boolean;
    include: string[];
    exclude: string[];

    constructor(options: RepeatSubmissionOptions) {
        super(options);
        const {
            threshold = 5,
            window = 15,
            gapAllowance,
            usePostAsReference = true,
            include = [],
            exclude = []
        } = options;
        this.threshold = threshold;
        this.window = window;
        this.gapAllowance = gapAllowance;
        this.usePostAsReference = usePostAsReference;
        this.include = include;
        this.exclude = exclude;
    }

    getKind(): string {
        return 'Repeat Submission';
    }

    getSpecificPremise(): object {
        return {
            threshold: this.threshold,
            window: this.window,
            gapAllowance: this.gapAllowance,
            usePostAsReference: this.usePostAsReference,
            include: this.include,
            exclude: this.exclude,
        }
    }

    async process(item: Submission): Promise<[boolean, RuleResult[]]> {
        const referenceUrl = await item.url;
        if (referenceUrl === undefined && this.usePostAsReference) {
            throw new Error(`Cannot run Rule ${this.name} because submission is not a link`);
        }
        const submissions = await getAuthorSubmissions(item.author, {window: this.window});

        // we need to check in order
        if (this.gapAllowance !== undefined) {
            let consecutivePosts = referenceUrl !== undefined ? 1 : 0;
            let gap = 0;
            let lastUrl = parseUsableLinkIdentifier(referenceUrl);
            // start with second post since first is the one we triggered on (prob)
            for (const sub of submissions.slice(1)) {
                if (sub.url !== undefined) {
                    const regUrl = parseUsableLinkIdentifier(sub.url);
                    if (lastUrl === undefined || lastUrl === regUrl) {
                        consecutivePosts++;
                        gap = 0;
                    } else {
                        gap++;
                        if (gap > this.gapAllowance) {
                            gap = 0;
                            consecutivePosts = 1;
                        }
                    }
                    lastUrl = regUrl;
                } else {
                    gap++;
                    if (gap > this.gapAllowance) {
                        gap = 0;
                        consecutivePosts = 0;
                    }
                }
                if (consecutivePosts >= this.threshold) {
                    const result = `Threshold of ${this.threshold} repeats triggered for submission with url ${sub.url}`;
                    this.logger.debug(result);
                    return Promise.resolve([true, [this.getResult(true, {result})]]);
                }
            }
            return Promise.resolve([false, [this.getResult(false)]]);
        }

        // otherwise we can just group all occurrences together
        const groupedPosts = groupByUrl(submissions.map(x => ({
            ...x,
            urlIdentifier: parseUsableLinkIdentifier(x.url)
        })));
        let groupsToCheck = [];
        if (this.usePostAsReference) {
            const identifier = parseUsableLinkIdentifier(referenceUrl);
            const {[identifier as string]: refGroup = []} = groupedPosts;
            groupsToCheck.push(refGroup);
        } else {
            groupsToCheck = Object.values(groupedPosts)
        }
        for (const group of groupsToCheck) {
            if (group.length >= this.threshold) {
                // @ts-ignore
                const result = `Threshold of ${this.threshold} repeats triggered for submission with url ${group[0].url}`;
                this.logger.debug(result);
                return Promise.resolve([true, [this.getResult(true, {result})]]);
            }
        }
        return Promise.resolve([false, [this.getResult(false)]]);
    }
}

interface RepeatSubmissionConfig {
    threshold: number,
    window?: string | number,
    gapAllowance?: number,
    usePostAsReference?: boolean,
    include?: string[],
    exclude?: string[],
}

export interface RepeatSubmissionOptions extends RepeatSubmissionConfig, RuleOptions {

}

export interface RepeatSubmissionJSONConfig extends RepeatSubmissionConfig, SubmissionRuleJSONConfig {

}

export default RepeatSubmissionRule;
