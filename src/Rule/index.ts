import Snoowrap, {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Logger} from "winston";
import {findResultByPremise, mergeArr} from "../util";
import {checkAuthorFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {ChecksActivityState, TypedActivityStates} from "../Common/interfaces";
import Author, {AuthorOptions} from "../Author/Author";

export interface RuleOptions {
    name?: string;
    authorIs?: AuthorOptions;
    itemIs?: TypedActivityStates;
    logger: Logger
    subredditName: string;
    resources: SubredditResources
    client: Snoowrap
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
    kind: string
    name: string
    triggered: (boolean | null)
}

export type FormattedRuleResult = RuleResult & {
    triggered: string
    result: string
}

export interface RuleSetResult {
    results: RuleResult[],
    condition: 'OR' | 'AND',
    triggered: boolean
}

export const isRuleSetResult = (obj: any): obj is RuleSetResult => {
    return typeof obj === 'object' && Array.isArray(obj.results) && obj.condition !== undefined && obj.triggered !== undefined;
}

export interface Triggerable {
    run(item: Comment | Submission, existingResults: RuleResult[]): Promise<[(boolean | null), RuleResult?]>;
}

export abstract class Rule implements IRule, Triggerable {
    name: string;
    logger: Logger
    authorIs: AuthorOptions;
    itemIs: TypedActivityStates;
    resources: SubredditResources;
    client: Snoowrap;

    constructor(options: RuleOptions) {
        const {
            name = this.getKind(),
            logger,
            authorIs: {
                excludeCondition = 'OR',
                include = [],
                exclude = [],
            } = {},
            itemIs = [],
            subredditName,
            resources,
            client,
        } = options;
        this.name = name;
        this.resources = resources;
        this.client = client;

        this.authorIs = {
            excludeCondition,
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }

        this.itemIs = itemIs;

        this.logger = logger.child({labels: [`Rule ${this.getRuleUniqueName()}`]}, mergeArr);
    }

    async run(item: Comment | Submission, existingResults: RuleResult[] = []): Promise<[(boolean | null), RuleResult]> {
        try {
            const existingResult = findResultByPremise(this.getPremise(), existingResults);
            if (existingResult) {
                this.logger.debug(`Returning existing result of ${existingResult.triggered ? '✔️' : '❌'}`);
                return Promise.resolve([existingResult.triggered, {...existingResult, name: this.name}]);
            }
            const itemPass = await this.resources.testItemCriteria(item, this.itemIs);
            if (!itemPass) {
                this.logger.verbose(`(Skipped) Item did not pass 'itemIs' test`);
                return Promise.resolve([null, this.getResult(null, {result: `Item did not pass 'itemIs' test`})]);
            }
            const [authFilterResult, authFilterType] = await checkAuthorFilter(item, this.authorIs, this.resources, this.logger);
            if(!authFilterResult) {
                this.logger.verbose(`(Skipped) ${authFilterType} Author criteria not matched`);
                return Promise.resolve([null, this.getResult(null, {result: `${authFilterType} author criteria not matched`})]);
            }
        } catch (err: any) {
            this.logger.error('Error occurred during Rule pre-process checks');
            throw err;
        }
        try {
            return this.process(item);
        } catch (err: any) {
            this.logger.error('Error occurred while processing rule');
            throw err;
        }
    }

    protected abstract process(item: Comment | Submission): Promise<[boolean, RuleResult]>;

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
            kind: this.getKind(),
            name: this.name,
            triggered,
            ...context,
        };
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
    kind: 'recentActivity' | 'repeatActivity' | 'author' | 'attribution' | 'history' | 'regex' | 'repost'
}

