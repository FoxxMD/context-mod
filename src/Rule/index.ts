import {Comment, RedditUser, Submission} from "snoowrap";
import {Logger} from "winston";
import {createLabelledLogger} from "../util";
import {testAuthorCriteria} from "../Utils/SnoowrapUtils";

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
    authors: AuthorOptions;

    constructor(options: RuleOptions) {
        const {
            name = this.getDefaultName(),
            loggerPrefix = '',
            logger,
            authors: {
                include = [],
                exclude = [],
            } = {},
        } = options;
        this.name = name || 'Rule';

        this.authors = {
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }

        if (logger === undefined) {
            const prefix = `${loggerPrefix}|${this.name}`;
            this.logger = createLabelledLogger(prefix, prefix);
        } else {
            this.logger = logger;
        }
    }

    async run(item: Comment | Submission): Promise<[boolean, Rule[]]> {
        let author: RedditUser;
        if(this.authors.include !== undefined && this.authors.include.length > 0) {
            for(const auth of this.authors.include) {
                if(await testAuthorCriteria(item, auth)) {
                    return Promise.resolve([true, [this]]);
                }
            }
            return Promise.resolve([false, [this]]);
        }
        if(this.authors.exclude !== undefined && this.authors.exclude.length > 0) {
            for(const auth of this.authors.exclude) {
                if(await testAuthorCriteria(item, auth, false)) {
                    return Promise.resolve([true, [this]]);
                }
            }
            return Promise.resolve([false, [this]]);
        }
        return Promise.resolve([true, [this]]);
    }
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

