import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Logger} from "winston";
import {findResultByPremise, mergeArr} from "../util";
import ResourceManager, {SubredditResources} from "../Subreddit/SubredditResources";
import {ChecksActivityState, TypedActivityStates} from "../Common/interfaces";
import {isItem} from "../Utils/SnoowrapUtils";

export interface RuleOptions {
    name?: string;
    authors?: AuthorOptions;
    logger: Logger
    subredditName: string;
    itemIs?: TypedActivityStates;
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
    name: string
    triggered: (boolean | null)
}

export interface Triggerable {
    run(item: Comment | Submission, existingResults: RuleResult[]): Promise<[(boolean | null), RuleResult[]]>;
}

export abstract class Rule implements IRule, Triggerable {
    name: string;
    logger: Logger
    authors: AuthorOptions;
    resources: SubredditResources;
    itemIs: TypedActivityStates;

    constructor(options: RuleOptions) {
        const {
            name = this.getKind(),
            logger,
            authors: {
                include = [],
                exclude = [],
            } = {},
            itemIs = [],
            subredditName,
        } = options;
        this.name = name;
        this.resources = ResourceManager.get(subredditName) as SubredditResources;

        this.authors = {
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }

        this.itemIs = itemIs;

        const ruleUniqueName = this.name === undefined ? this.getKind() : `${this.getKind()} - ${this.name}`;
        this.logger = logger.child({labels: ['Rule',`${ruleUniqueName}`]}, mergeArr);
    }

    async run(item: Comment | Submission, existingResults: RuleResult[] = []): Promise<[(boolean | null), RuleResult[]]> {
        const existingResult = findResultByPremise(this.getPremise(), existingResults);
        if (existingResult) {
            this.logger.debug(`Returning existing result of ${existingResult.triggered ? '✔️' : '❌'}`);
            return Promise.resolve([existingResult.triggered, [{...existingResult, name: this.name}]]);
        }
        const [itemPass, crit] = isItem(item, this.itemIs, this.logger);
        if(!itemPass) {
            this.logger.verbose(`Item did not pass 'itemIs' test, rule running skipped`);
            return Promise.resolve([null, [this.getResult(null, {result: `Item did not pass 'itemIs' test, rule running skipped`})]]);
        }
        if (this.authors.include !== undefined && this.authors.include.length > 0) {
            for (const auth of this.authors.include) {
                if (await this.resources.testAuthorCriteria(item, auth)) {
                    return this.process(item);
                }
            }
            this.logger.verbose('Inclusive author criteria not matched, rule running skipped');
            return Promise.resolve([null, [this.getResult(null, {result: 'Inclusive author criteria not matched, rule running skipped'})]]);
        }
        if (this.authors.exclude !== undefined && this.authors.exclude.length > 0) {
            for (const auth of this.authors.exclude) {
                if (await this.resources.testAuthorCriteria(item, auth, false)) {
                    return this.process(item);
                }
            }
            this.logger.verbose('Exclusive author criteria not matched, rule running skipped');
            return Promise.resolve([null, [this.getResult(null, {result: 'Exclusive author criteria not matched, rule running skipped'})]]);
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

export class Author implements AuthorCriteria {
    name?: string[];
    flairCssClass?: string[];
    flairText?: string[];
    isMod?: boolean;
    userNotes?: UserNoteCriteria[];

    constructor(options: AuthorCriteria) {
        this.name = options.name;
        this.flairCssClass = options.flairCssClass;
        this.flairText = options.flairText;
        this.isMod = options.isMod;
        this.userNotes = options.userNotes;
    }
}

export interface UserNoteCriteria {
    /**
     * User Note type key
     * @examples ["spamwarn"]
     * */
    type: string;
    /**
     * Number of occurrences of this type. Ignored if `search` is `current`
     * @examples [1]
     * @default 1
     * */
    count?: number;

    /**
     * * If `current` then only the most recent note is checked
     * * If `consecutive` then `count` number of `type` notes must be found in a row, based on `order` direction
     * * If `total` then `count` number of `type` must be found within all notes
     * @examples ["current"]
     * @default current
     * */
    search?: 'current' | 'consecutive' | 'total'
    /**
     * Time-based order to search Notes in for `consecutive` search
     * @examples ["descending"]
     * @default descending
     * */
    order?: 'ascending' | 'descending'
}

/**
 * If present then these Author criteria are checked before running the rule. If criteria fails then the rule is skipped.
 * @minProperties 1
 * @additionalProperties false
 * @TJS-type object
 * */
export interface AuthorOptions {
    /**
     * Will "pass" if any set of AuthorCriteria passes
     * */
    include?: AuthorCriteria[];
    /**
     * Only runs if include is not present. Will "pass" if any of set of the AuthorCriteria does not pass
     * */
    exclude?: AuthorCriteria[];
}

/**
 * Criteria with which to test against the author of an Activity. The outcome of the test is based on:
 *
 * 1. All present properties passing and
 * 2. If a property is a list then any value from the list matching
 *
 * @minProperties 1
 * @additionalProperties false
 * */
export interface AuthorCriteria {
    /**
     * A list of reddit usernames (case-insensitive) to match against. Do not include the "u/" prefix
     *
     *  EX to match against /u/FoxxMD and /u/AnotherUser use ["FoxxMD","AnotherUser"]
     * @examples ["FoxxMD","AnotherUser"]
     * */
    name?: string[],
    /**
     * A list of (user) flair css class values from the subreddit to match against
     * @examples ["red"]
     * */
    flairCssClass?: string[],
    /**
     * A list of (user) flair text values from the subreddit to match against
     * @examples ["Approved"]
     * */
    flairText?: string[],
    /**
     * Is the author a moderator?
     * */
    isMod?: boolean,
    /**
     * A list of UserNote properties to check against the User Notes attached to this Author in this Subreddit (must have Toolbox enabled and used User Notes at least once)
     * */
    userNotes?: UserNoteCriteria[]
}

export interface IRule extends ChecksActivityState {
    /**
     * An optional, but highly recommended, friendly name for this rule. If not present will default to `kind`.
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * name is used to reference Rule result data during Action content templating. See CommentAction or ReportAction for more details.
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * @examples ["myNewRule"]
     * */
    name?: string
    /**
     * If present then these Author criteria are checked before running the rule. If criteria fails then the rule is skipped.
     * */
    authors?: AuthorOptions
    /**
     * A list of criteria to test the state of the `Activity` against before running the Rule.
     *
     * If any set of criteria passes the Rule will be run. If the criteria fails then the Rule is skipped.
     * */
    itemIs?: TypedActivityStates
}

export interface RuleJSONConfig extends IRule {
    /**
     * The kind of rule to run
     * @examples ["recentActivity", "repeatActivity", "author", "attribution", "history"]
     */
    kind: 'recentActivity' | 'repeatActivity' | 'author' | 'attribution' | 'history'
}

