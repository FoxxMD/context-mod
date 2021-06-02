import {Author, AuthorOptions, IAuthor, Rule, RuleJSONConfig, RuleOptions, RuleResult} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {testAuthorCriteria} from "../Utils/SnoowrapUtils";

export interface AuthorRuleConfig extends AuthorOptions {
    include: IAuthor[];
    exclude: IAuthor[];
}

export interface AuthorRuleOptions extends AuthorRuleConfig, RuleOptions {

}

export interface AuthorRuleJSONConfig extends AuthorRuleConfig, RuleJSONConfig {

}

export class AuthorRule extends Rule {
    include: IAuthor[] = [];
    exclude: IAuthor[] = [];

    constructor(options: AuthorRuleOptions) {
        super(options);

        this.include = options.include.map(x => new Author(x));
        this.exclude = options.exclude.map(x => new Author(x));

        if(this.include.length === 0 && this.exclude.length === 0) {
            throw new Error('At least one of the properties [include,exclude] on Author Rule must not be empty');
        }
    }

    getKind(): string {
        return "Author";
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
                if (await testAuthorCriteria(item, auth)) {
                    return Promise.resolve([true, [this.getResult(true)]]);
                }
            }
            return Promise.resolve([false, [this.getResult(false)]]);
        }
        for (const auth of this.exclude) {
            if (await testAuthorCriteria(item, auth, false)) {
                return Promise.resolve([true, [this.getResult(true)]]);
            }
        }
        return Promise.resolve([false, [this.getResult(false)]]);
    }
}

export default AuthorRule;
