import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Logger} from "winston";
import {findResultByPremise, mergeArr} from "../util";
import ResourceManager, {SubredditResources} from "../Subreddit/SubredditResources";
import {ChecksActivityState, CompareValue, CompareValueOrPercent, TypedActivityStates} from "../Common/interfaces";
import {isItem} from "../Utils/SnoowrapUtils";

export interface RuleOptions {
    name?: string;
    authorIs?: AuthorOptions;
    itemIs?: TypedActivityStates;
    logger: Logger
    subredditName: string;
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
    authorIs: AuthorOptions;
    itemIs: TypedActivityStates;
    resources: SubredditResources;

    constructor(options: RuleOptions) {
        const {
            name = this.getKind(),
            logger,
            authorIs: {
                include = [],
                exclude = [],
            } = {},
            itemIs = [],
            subredditName,
        } = options;
        this.name = name;
        this.resources = ResourceManager.get(subredditName) as SubredditResources;

        this.authorIs = {
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }

        this.itemIs = itemIs;

        this.logger = logger.child({labels: ['Rule',`${this.getRuleUniqueName()}`]}, mergeArr);
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
        if (this.authorIs.include !== undefined && this.authorIs.include.length > 0) {
            for (const auth of this.authorIs.include) {
                if (await this.resources.testAuthorCriteria(item, auth)) {
                    return this.process(item);
                }
            }
            this.logger.verbose('Inclusive author criteria not matched, rule running skipped');
            return Promise.resolve([null, [this.getResult(null, {result: 'Inclusive author criteria not matched, rule running skipped'})]]);
        }
        if (this.authorIs.exclude !== undefined && this.authorIs.exclude.length > 0) {
            for (const auth of this.authorIs.exclude) {
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

    getRuleUniqueName() {
        return this.name === undefined ? this.getKind() : `${this.getKind()} - ${this.name}`;
    }

    protected abstract getSpecificPremise(): object;

    getPremise(): RulePremise {
        const config = this.getSpecificPremise();
        return {
            kind: this.getKind(),
            config: {
                authorIs: this.authorIs,
                itemIs: this.itemIs,
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
    age?: string;

    constructor(options: AuthorCriteria) {
        this.name = options.name;
        this.flairCssClass = options.flairCssClass;
        this.flairText = options.flairText;
        this.isMod = options.isMod;
        this.userNotes = options.userNotes;
        this.age = options.age;
    }
}

export interface UserNoteCriteria {
    /**
     * User Note type key to search for
     * @examples ["spamwarn"]
     * */
    type: string;
    /**
     * Number of occurrences of this type. Ignored if `search` is `current`
     *
     * A string containing a comparison operator and/or a value to compare number of occurrences against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign] [ascending|descending]`
     *
     * @examples [">= 1"]
     * @default ">= 1"
     * @pattern ^\s*(?<opStr>>|>=|<|<=)\s*(?<value>\d+)\s*(?<percent>%?)\s*(?<extra>asc.*|desc.*)*$
     * */
    count?: string;

    /**
     * How to test the notes for this Author:
     *
     * ### current
     *
     * Only the most recent note is checked for `type`
     *
     * ### total
     *
     * The `count` comparison of `type` must be found within all notes
     *
     * * EX `count: > 3`   => Must have more than 3 notes of `type`, total
     * * EX `count: <= 25%` => Must have 25% or less of notes of `type`, total
     *
     * ### consecutive
     *
     * The `count` **number** of `type` notes must be found in a row.
     *
     * You may also specify the time-based order in which to search the notes by specifying `ascending (asc)` or `descending (desc)` in the `count` value. Default is `descending`
     *
     * * EX `count: >= 3` => Must have 3 or more notes of `type` consecutively, in descending order
     * * EX `count: < 2`  => Must have less than 2 notes of `type` consecutively, in descending order
     * * EX `count: > 4 asc` => Must have greater than 4 notes of `type` consecutively, in ascending order
     *
     * @examples ["current"]
     * @default current
     * */
    search?: 'current' | 'consecutive' | 'total'
}

/**
 * If present then these Author criteria are checked before running the rule. If criteria fails then the rule is skipped.
 * @examples [{"include": [{"flairText": ["Contributor","Veteran"]}, {"isMod": true}]}]
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
 * @examples [{"flairText": ["Contributor","Veteran"], "isMod": true, "name": ["FoxxMD", "AnotherUser"] }]
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

    /**
     * Test the age of the Author's account (when it was created) against this comparison
     *
     * The syntax is `(< OR > OR <= OR >=) <number> <unit>`
     *
     * * EX `> 100 days` => Passes if Author's account is older than 100 days
     * * EX `<= 2 months` => Passes if Author's account is younger than or equal to 2 months
     *
     * Unit must be one of [DayJS Duration units](https://day.js.org/docs/en/durations/creating)
     *
     * [See] https://regexr.com/609n8 for example
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(days|weeks|months|years|hours|minutes|seconds|milliseconds)\s*$
     * */
    age?: DurationComparor

    /**
     * A string containing a comparison operator and a value to compare link karma against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 100`  => greater than 100 link karma
     * * EX `<= 75%` => link karma is less than or equal to 75% of **all karma**
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    linkKarma?: CompareValueOrPercent

    /**
     * A string containing a comparison operator and a value to compare karma against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 100`  => greater than 100 comment karma
     * * EX `<= 75%` => comment karma is less than or equal to 75% of **all karma**
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    commentKarma?: CompareValueOrPercent

    totalKarma?: CompareValue

    /**
     * Does Author's account have a verified email?
     * */
    verified?: boolean
}

/**
 * A duration and how to compare it against a value
 *
 * The syntax is `(< OR > OR <= OR >=) <number> <unit>` EX `> 100 days`, `<= 2 months`
 *
 * * EX `> 100 days` => Passes if the date being compared is before 100 days ago
 * * EX `<= 2 months` => Passes if the date being compared is after or equal to 2 months
 *
 * Unit must be one of [DayJS Duration units](https://day.js.org/docs/en/durations/creating)
 *
 * [See] https://regexr.com/609n8 for example
 *
 * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(days|weeks|months|years|hours|minutes|seconds|milliseconds)\s*$
 * */
export type DurationComparor = string;

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
    authorIs?: AuthorOptions
    /**
     * A list of criteria to test the state of the `Activity` against before running the Rule.
     *
     * If any set of criteria passes the Rule will be run. If the criteria fails then the Rule is skipped.
     *
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

