import {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {createLabelledLogger} from "../util";

export interface RuleOptions {
    name?: string;
    authors?: AuthorOptions;
    logger?: Logger
    loggerPrefix?: string
}

export interface Triggerable {
    run(item: Comment | Submission): Promise<[boolean, Rule[]]>;
}

export abstract class Rule implements IRule, Triggerable {
    name: string;
    logger: Logger
    authors: AuthorOptions = {exclude: [], include: []};

    constructor(options: RuleOptions) {
        const {
            name = this.getDefaultName(),
            loggerPrefix = '',
            logger,
        } = options;
        this.name = name || 'Rule';
        if (options.authors !== undefined) {
            const {exclude = [], include = []} = options.authors;
            this.authors.exclude = exclude.map(x => new Author(x));
            this.authors.include = include.map(x => new Author(x));
        }
        if (logger === undefined) {
            const prefix = `${loggerPrefix}|${this.name}`;
            this.logger = createLabelledLogger(prefix, prefix);
        } else {
            this.logger = logger;
        }
    }

    abstract run(item: Comment | Submission): Promise<[boolean, Rule[]]>;
    abstract getDefaultName(): string;
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
    name?: string
    authors?: AuthorOptions
}

/** @see {isRuleConfig} ts-auto-guard:type-guard */
export interface RuleJSONConfig extends IRule {
    kind: 'recentActivity' | 'repeatSubmission'
}

