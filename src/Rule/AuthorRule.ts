import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {checkAuthorFilter} from "../Subreddit/SubredditResources";
import {
    RuleResult
} from "../Common/interfaces";
import {buildFilter, normalizeCriteria} from "../util";
import {
    AuthorOptions,
    MaybeAnonymousCriteria,
    MaybeAnonymousOrStringCriteria,
    NamedCriteria
} from "../Common/Infrastructure/Filters/FilterShapes";
import {AuthorCriteria} from "../Common/Infrastructure/Filters/FilterCriteria";

/**
 * Checks the author of the Activity against AuthorCriteria. This differs from a Rule's AuthorOptions as this is a full Rule and will only pass/fail, not skip.
 * @minProperties 1
 * @additionalProperties false
 * */
export interface AuthorRuleConfig {
    /**
     * Will "pass" if any set of AuthorCriteria passes
     * */
    include?: MaybeAnonymousCriteria<AuthorCriteria>[];
    /**
     * Only runs if include is not present. Will "pass" if any of set of the AuthorCriteria does not pass
     * */
    exclude?: MaybeAnonymousCriteria<AuthorCriteria>[];
}

export interface AuthorRuleOptions extends Omit<AuthorRuleConfig, 'include' | 'exclude'>, RuleOptions {
    include?: NamedCriteria<AuthorCriteria>[]
    exclude?: NamedCriteria<AuthorCriteria>[]
}

export interface AuthorRuleJSONConfig extends AuthorRuleConfig, RuleJSONConfig {
    kind: 'author'
}

export class AuthorRule extends Rule {

    authorOptions: AuthorOptions;

    constructor(options: AuthorRuleOptions) {
        super(options);

        this.authorOptions = buildFilter(options ?? {});

        if(this.authorOptions.include?.length === 0 && this.authorOptions.exclude?.length === 0) {
            throw new Error('At least one of the properties [include,exclude] on Author Rule must not be empty');
        }
    }

    getKind(): string {
        return "author";
    }

    protected getSpecificPremise(): object {
        return this.authorOptions;
    }

    protected async process(item: Comment | Submission): Promise<[boolean, RuleResult]> {
        const [result, filterType] = await checkAuthorFilter(item, this.authorOptions, this.resources, this.logger);
        return Promise.resolve([result, this.getResult(result)]);
    }
}

export default AuthorRule;
