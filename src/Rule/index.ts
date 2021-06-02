import {Comment, RedditUser, Submission} from "snoowrap";
import {Logger} from "winston";
import {createLabelledLogger, findResultByPremise} from "../util";
import {testAuthorCriteria} from "../Utils/SnoowrapUtils";

export interface RuleOptions {
    name?: string;
    authors?: AuthorOptions;
    logger?: Logger
    loggerPrefix?: string
}

export interface RulePremise {
    kind: string
    config: object
}

interface ResultContext {
    result?: string
    data?: any
}

export interface RuleResult extends ResultContext {
    premise: RulePremise
    name?: string
    triggered: (boolean | null)
}

export interface Triggerable {
    run(item: Comment | Submission, existingResults: RuleResult[]): Promise<[(boolean | null), RuleResult[]]>;
}

export abstract class Rule implements IRule, Triggerable {
    name?: string;
    logger: Logger
    authors: AuthorOptions;

    constructor(options: RuleOptions) {
        const {
            name,
            loggerPrefix = '',
            logger,
            authors: {
                include = [],
                exclude = [],
            } = {},
        } = options;
        this.name = name;

        this.authors = {
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }

        if (logger === undefined) {
            const ruleUniqueName = this.name === undefined ? this.getKind() : `${this.getKind()} - ${this.name}`;
            const prefix = `${loggerPrefix}|${ruleUniqueName}`;
            this.logger = createLabelledLogger(prefix, prefix);
        } else {
            this.logger = logger;
        }
    }

    async run(item: Comment | Submission, existingResults: RuleResult[] = []): Promise<[(boolean | null), RuleResult[]]> {
        const existingResult = findResultByPremise(this.getPremise(), existingResults);
        if (existingResult) {
            return Promise.resolve([existingResult.triggered, [existingResult]]);
        }
        if (this.authors.include !== undefined && this.authors.include.length > 0) {
            for (const auth of this.authors.include) {
                if (await testAuthorCriteria(item, auth)) {
                    return this.process(item);
                }
            }
            return Promise.resolve([false, [this.getResult(null, {result: 'Inclusive author criteria not matched, rule running skipped'})]]);
        }
        if (this.authors.exclude !== undefined && this.authors.exclude.length > 0) {
            for (const auth of this.authors.exclude) {
                if (await testAuthorCriteria(item, auth, false)) {
                    return this.process(item);
                }
            }
            return Promise.resolve([false, [this.getResult(null, {result: 'Exclusive author criteria not matched, rule running skipped'})]]);
        }
        return this.process(item);
    }

    protected abstract process(item: Comment | Submission): Promise<[boolean, RuleResult[]]>;

    abstract getKind(): string;

    protected abstract getSpecificPremise(): object;

    getPremise(): RulePremise {
        const config = this.getSpecificPremise();
        return {
            kind: this.getKind(),
            config: {
                authors: this.authors,
                ...config,
            },
        };
    }

    protected getResult(triggered: (boolean | null) = null, context: ResultContext = {}): RuleResult {
        return {
            premise: this.getPremise(),
            name: this.name,
            triggered,
            ...context,
        };
    }
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

