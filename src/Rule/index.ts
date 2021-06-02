import {Comment, RedditUser} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Logger} from "winston";
import {createLabelledLogger, findResultByPremise, loggerMetaShuffle, mergeArr} from "../util";
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

        const ruleUniqueName = this.name === undefined ? this.getKind() : `${this.getKind()} - ${this.name}`;
        if (logger === undefined) {
            const prefix = `${loggerPrefix}|${ruleUniqueName}`;
            this.logger = createLabelledLogger(prefix, prefix);
        } else {
            this.logger = logger.child(loggerMetaShuffle(logger, undefined, [ruleUniqueName], {truncateLength: 100}));
        }
    }

    async run(item: Comment | Submission, existingResults: RuleResult[] = []): Promise<[(boolean | null), RuleResult[]]> {
        this.logger = this.logger.child(loggerMetaShuffle(this.logger, `${item instanceof Submission ? 'SUB' : 'COMM'} ${item.id}`), mergeArr);
        this.logger.debug('Starting rule run');
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
            this.logger.debug('Inclusive author criteria not matched, rule running skipped');
            return Promise.resolve([false, [this.getResult(null, {result: 'Inclusive author criteria not matched, rule running skipped'})]]);
        }
        if (this.authors.exclude !== undefined && this.authors.exclude.length > 0) {
            for (const auth of this.authors.exclude) {
                if (await testAuthorCriteria(item, auth, false)) {
                    return this.process(item);
                }
            }
            this.logger.debug('Exclusive author criteria not matched, rule running skipped');
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
    kind: 'recentActivity' | 'repeatSubmission' | 'author'
}

