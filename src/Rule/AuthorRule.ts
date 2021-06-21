import {Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Author, AuthorCriteria} from "../Author/Author";

/**
 * Checks the author of the Activity against AuthorCriteria. This differs from a Rule's AuthorOptions as this is a full Rule and will only pass/fail, not skip.
 * @minProperties 1
 * @additionalProperties false
 * */
export interface AuthorRuleConfig {
    /**
     * Will "pass" if any set of AuthorCriteria passes
     * */
    include: AuthorCriteria[];
    /**
     * Only runs if include is not present. Will "pass" if any of set of the AuthorCriteria does not pass
     * */
    exclude: AuthorCriteria[];
}

export interface AuthorRuleOptions extends AuthorRuleConfig, RuleOptions {

}

export interface AuthorRuleJSONConfig extends AuthorRuleConfig, RuleJSONConfig {
    kind: 'author'
}

export class AuthorRule extends Rule {
    include: AuthorCriteria[] = [];
    exclude: AuthorCriteria[] = [];

    constructor(options: AuthorRuleOptions) {
        super(options);

        this.include = options.include.map(x => new Author(x));
        this.exclude = options.exclude.map(x => new Author(x));

        if(this.include.length === 0 && this.exclude.length === 0) {
            throw new Error('At least one of the properties [include,exclude] on Author Rule must not be empty');
        }
    }

    getKind(): string {
        return "author";
    }

    protected getSpecificPremise(): object {
        return {
            include: this.include,
            exclude: this.exclude,
        };
    }

    protected async process(item: Comment | Submission): Promise<[boolean, RuleResult[]]> {
        if (this.include.length > 0) {
            for (const auth of this.include) {
                if (await this.resources.testAuthorCriteria(item, auth)) {
                    return Promise.resolve([true, [this.getResult(true)]]);
                }
            }
            return Promise.resolve([false, [this.getResult(false)]]);
        }
        for (const auth of this.exclude) {
            if (await this.resources.testAuthorCriteria(item, auth, false)) {
                return Promise.resolve([true, [this.getResult(true)]]);
            }
        }
        return Promise.resolve([false, [this.getResult(false)]]);
    }
}

export default AuthorRule;
