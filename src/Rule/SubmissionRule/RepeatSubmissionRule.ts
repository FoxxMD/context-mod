import {SubmissionRule, SubmissionRuleJSONConfig} from "./index";
import {Rule, RuleOptions} from "../index";
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

    getDefaultName(): string {
        return 'Repeat Submission';
    }

    async passes(item: Submission): Promise<[boolean, Rule[]]> {
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
                    this.logger.debug(`Threshold of ${this.threshold} repeats triggered for submission with url ${sub.url}`);
                    return Promise.resolve([false, [this]]);
                }
            }
            return Promise.resolve([true, [this]]);
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
                this.logger.debug(`Threshold of ${this.threshold} repeats triggered for submission with url ${group[0].url}`);
                return Promise.resolve([false, [this]]);
            }
        }
        return Promise.resolve([true, [this]]);
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
