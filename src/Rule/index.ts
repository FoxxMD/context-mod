import {RecentActivityRule, RecentActivityRuleJSONConfig} from "./RecentActivityRule";
import RepeatSubmissionRule, {RepeatSubmissionJSONConfig} from "./SubmissionRule/RepeatSubmissionRule";
import {Comment, Submission} from "snoowrap";
import {Passable} from "./Passable";

export interface RuleOptions {
    name: string;
    authors?: AuthorOptions;
}

export abstract class Rule implements IRule, Passable {
    name: string;
    authors: AuthorOptions = {exclude: [], include: []};

    constructor(options: RuleOptions) {
        this.name = options.name;
        if (options.authors !== undefined) {
            const {exclude = [], include = []} = options.authors;
            this.authors.exclude = exclude.map(x => new Author(x));
            this.authors.include = include.map(x => new Author(x));
        }
    }

    abstract passes(item: Comment|Submission): Promise<[boolean, Rule[]]>;
}

export class Author implements IAuthor {
    name?: string[];
    flairCssClass?: string[];
    flairText?: string[];
    isMod?: boolean;

    constructor(options: IAuthor) {
        this.name = options.name;
        this.flairCssClass = options.flairCssClass;
        this.flairText = options.flairText;
        this.isMod = options.isMod;
    }
}

export interface AuthorOptions {
    exclude?: IAuthor[];
    include?: IAuthor[];
}

export interface IAuthor {
    name?: string[],
    flairCssClass?: string[],
    flairText?: string[],
    isMod?: boolean,
}

export interface IRule {
    name: string
    authors?: AuthorOptions
}

/** @see {isRuleConfig} ts-auto-guard:type-guard */
export interface RuleJSONConfig extends IRule {
    kind: 'recentActivity' | 'repeatSubmission'
}

export function ruleFactory
(config: RuleJSONConfig): Rule {
    switch (config.kind) {
        case 'recentActivity':
            return new RecentActivityRule(config as RecentActivityRuleJSONConfig);
        case 'repeatSubmission':
            return new RepeatSubmissionRule(config as RepeatSubmissionJSONConfig);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
