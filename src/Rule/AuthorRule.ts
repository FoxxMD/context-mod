import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {checkAuthorFilter} from "../Subreddit/SubredditResources";
import {AuthorCriteria, RuleResult} from "../Common/interfaces";
import {normalizeCriteria} from "../util";

/**
 * Checks the author of the Activity against AuthorCriteria. This differs from a Rule's AuthorOptions as this is a full Rule and will only pass/fail, not skip.
 * @minProperties 1
 * @additionalProperties false
 * */
export interface AuthorRuleConfig {
    /**
     * Will "pass" if any set of AuthorCriteria passes
     * */
    include?: AuthorCriteria[];
    /**
     * Only runs if include is not present. Will "pass" if any of set of the AuthorCriteria does not pass
     * */
    exclude?: AuthorCriteria[];
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

        const {
            include,
            exclude,
        } = options;

        this.include = include !== undefined ? include.map(x => normalizeCriteria(x)) : [];
        this.exclude = exclude !== undefined ? exclude.map(x => normalizeCriteria(x)) : [];

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

    protected async process(item: Comment | Submission): Promise<[boolean, RuleResult]> {
        const [result, filterType] = await checkAuthorFilter(item, {include: this.include, exclude: this.exclude}, this.resources, this.logger);
        return Promise.resolve([result, this.getResult(result)]);
    }
}

export default AuthorRule;
