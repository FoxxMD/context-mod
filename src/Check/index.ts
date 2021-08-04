import {RuleSet, IRuleSet, RuleSetJson, RuleSetObjectJson} from "../Rule/RuleSet";
import {IRule, isRuleSetResult, Rule, RuleJSONConfig, RuleResult, RuleSetResult} from "../Rule";
import Action, {ActionConfig, ActionJson} from "../Action";
import {Logger} from "winston";
import {Comment, Submission} from "snoowrap";
import {actionFactory} from "../Action/ActionFactory";
import {ruleFactory} from "../Rule/RuleFactory";
import {
    boolToString,
    createAjvFactory,
    FAIL,
    mergeArr,
    PASS,
    resultsSummary,
    ruleNamesFromResults,
    truncateStringToLength
} from "../util";
import {
    ChecksActivityState,
    CommentState,
    JoinCondition,
    JoinOperands,
    SubmissionState,
    TypedActivityStates
} from "../Common/interfaces";
import * as RuleSchema from '../Schema/Rule.json';
import * as RuleSetSchema from '../Schema/RuleSet.json';
import * as ActionSchema from '../Schema/Action.json';
import {ActionObjectJson, RuleJson, RuleObjectJson, ActionJson as ActionTypeJson} from "../Common/types";
import ResourceManager, {SubredditResources} from "../Subreddit/SubredditResources";
import {Author, AuthorCriteria, AuthorOptions} from "../Author/Author";

const checkLogName = truncateStringToLength(25);

export abstract class Check implements ICheck {
    actions: Action[] = [];
    description?: string;
    name: string;
    enabled: boolean;
    condition: JoinOperands;
    rules: Array<RuleSet | Rule> = [];
    logger: Logger;
    itemIs: TypedActivityStates;
    authorIs: {
        include: AuthorCriteria[],
        exclude: AuthorCriteria[]
    };
    dryRun?: boolean;
    notifyOnTrigger: boolean;
    resources: SubredditResources;

    constructor(options: CheckOptions) {
        const {
            enable = true,
            name,
            description,
            condition = 'AND',
            rules = [],
            actions = [],
            notifyOnTrigger = false,
            subredditName,
            itemIs = [],
            authorIs: {
                include = [],
                exclude = [],
            } = {},
            dryRun,
        } = options;

        this.enabled = enable;

        this.logger = options.logger.child({labels: [`CHK ${checkLogName(name)}`]}, mergeArr);

        const ajv = createAjvFactory(this.logger);

        this.resources = ResourceManager.get(subredditName) as SubredditResources;

        this.name = name;
        this.description = description;
        this.notifyOnTrigger = notifyOnTrigger;
        this.condition = condition;
        this.itemIs = itemIs;
        this.authorIs = {
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }
        this.dryRun = dryRun;
        for (const r of rules) {
            if (r instanceof Rule || r instanceof RuleSet) {
                this.rules.push(r);
            } else {
                let valid = ajv.validate(RuleSetSchema, r);
                let setErrors: any = [];
                let ruleErrors: any = [];
                if (valid) {
                    const ruleConfig = r as RuleSetObjectJson;
                    this.rules.push(new RuleSet({...ruleConfig, logger: this.logger, subredditName}));
                } else {
                    setErrors = ajv.errors;
                    valid = ajv.validate(RuleSchema, r);
                    if (valid) {
                        this.rules.push(ruleFactory(r as RuleJSONConfig, this.logger, subredditName));
                    } else {
                        ruleErrors = ajv.errors;
                        const leastErrorType = setErrors.length < ruleErrors ? 'RuleSet' : 'Rule';
                        const errors = setErrors.length < ruleErrors ? setErrors : ruleErrors;
                        this.logger.warn(`Could not parse object as RuleSet or Rule json. ${leastErrorType} validation had least errors`, {}, {
                            errors,
                            obj: r
                        });
                    }
                }
            }
        }

        for (const a of actions) {
            if (a instanceof Action) {
                this.actions.push(a);
            } else {
                let valid = ajv.validate(ActionSchema, a);
                if (valid) {
                    const aj = a as ActionJson;
                    this.actions.push(actionFactory({
                        ...aj,
                        dryRun: this.dryRun || aj.dryRun
                    }, this.logger, subredditName));
                    // @ts-ignore
                    a.logger = this.logger;
                } else {
                    this.logger.warn('Could not parse object as Action', {}, {error: ajv.errors, obj: a})
                }
            }
        }
    }

    logSummary(type: string) {
        const runStats = [];
        const ruleSetCount = this.rules.reduce((x, r) => r instanceof RuleSet ? x + 1 : x, 0);
        const rulesInSetsCount = this.rules.reduce((x, r) => r instanceof RuleSet ? x + r.rules.length : x, 0);
        if (ruleSetCount > 0) {
            runStats.push(`${ruleSetCount} Rule Sets (${rulesInSetsCount} Rules)`);
        }
        const topRuleCount = this.rules.reduce((x, r) => r instanceof Rule ? x + 1 : x, 0);
        if (topRuleCount > 0) {
            runStats.push(`${topRuleCount} Top-Level Rules`);
        }
        runStats.push(`${this.actions.length} Actions`);
        // not sure if this should be info or verbose
        this.logger.info(`=${this.enabled ? 'Enabled' : 'Disabled'}= ${type.toUpperCase()} (${this.condition})${this.notifyOnTrigger ? ' ||Notify on Trigger|| ' : ''} => ${runStats.join(' | ')}${this.description !== undefined ? ` => ${this.description}` : ''}`);
        if (this.rules.length === 0 && this.itemIs.length === 0 && this.authorIs.exclude.length === 0 && this.authorIs.include.length === 0) {
            this.logger.warn('No rules, item tests, or author test found -- this check will ALWAYS PASS!');
        }
        let ruleSetIndex = 1;
        for (const r of this.rules) {
            if (r instanceof RuleSet) {
                for (const ru of r.rules) {
                    this.logger.verbose(`(Rule Set ${ruleSetIndex} ${r.condition}) => ${ru.getRuleUniqueName()}`);
                }
                ruleSetIndex++;
            } else {
                this.logger.verbose(`(Rule) => ${r.getRuleUniqueName()}`);
            }
        }
        for (const a of this.actions) {
            this.logger.verbose(`(Action) => ${a.getActionUniqueName()}`);
        }
    }

    abstract getCacheResult(item: Submission | Comment) : Promise<boolean | undefined>;
    abstract setCacheResult(item: Submission | Comment, result: boolean): void;

    async runRules(item: Submission | Comment, existingResults: RuleResult[] = []): Promise<[boolean, RuleResult[]]> {
        try {
            let allRuleResults: RuleResult[] = [];
            let allResults: (RuleResult | RuleSetResult)[] = [];

            // check cache results
            const cacheResult = await this.getCacheResult(item);
            if(cacheResult !== undefined) {
                this.logger.verbose(`Skipping rules run because result was found in cache, Check Triggered Result: ${cacheResult}`);
                return [cacheResult, allRuleResults];
            }

            const itemPass = await this.resources.testItemCriteria(item, this.itemIs);
            if (!itemPass) {
                this.logger.verbose(`${FAIL} => Item did not pass 'itemIs' test`);
                return [false, allRuleResults];
            }
            let authorPass = null;
            if (this.authorIs.include !== undefined && this.authorIs.include.length > 0) {
                for (const auth of this.authorIs.include) {
                    if (await this.resources.testAuthorCriteria(item, auth)) {
                        authorPass = true;
                        break;
                    }
                }
                if (!authorPass) {
                    this.logger.verbose(`${FAIL} => Inclusive author criteria not matched`);
                    return Promise.resolve([false, allRuleResults]);
                }
            }
            if (authorPass === null && this.authorIs.exclude !== undefined && this.authorIs.exclude.length > 0) {
                for (const auth of this.authorIs.exclude) {
                    if (await this.resources.testAuthorCriteria(item, auth, false)) {
                        authorPass = true;
                        break;
                    }
                }
                if (!authorPass) {
                    this.logger.verbose(`${FAIL} =>  Exclusive author criteria not matched`);
                    return Promise.resolve([false, allRuleResults]);
                }
            }

            if (this.rules.length === 0) {
                this.logger.info(`${PASS} => No rules to run, check auto-passes`);
                return [true, allRuleResults];
            }

            let runOne = false;
            for (const r of this.rules) {
                //let results: RuleResult | RuleSetResult;
                const combinedResults = [...existingResults, ...allRuleResults];
                const [passed, results] = await r.run(item, combinedResults);
                if (isRuleSetResult(results)) {
                    allRuleResults = allRuleResults.concat(results.results);
                } else {
                    allRuleResults = allRuleResults.concat(results as RuleResult);
                }
                allResults.push(results);
                if (passed === null) {
                    continue;
                }
                runOne = true;
                if (passed) {
                    if (this.condition === 'OR') {
                        this.logger.info(`${PASS} => Rules: ${resultsSummary(allResults, this.condition)}`);
                        return [true, allRuleResults];
                    }
                } else if (this.condition === 'AND') {
                    this.logger.verbose(`${FAIL} => Rules: ${resultsSummary(allResults, this.condition)}`);
                    return [false, allRuleResults];
                }
            }
            if (!runOne) {
                this.logger.verbose(`${FAIL} => All Rules skipped because of Author checks or itemIs tests`);
                return [false, allRuleResults];
            } else if (this.condition === 'OR') {
                // if OR and did not return already then none passed
                this.logger.verbose(`${FAIL} => Rules: ${resultsSummary(allResults, this.condition)}`);
                return [false, allRuleResults];
            }
            // otherwise AND and did not return already so all passed
            this.logger.info(`${PASS} => Rules: ${resultsSummary(allResults, this.condition)}`);
            return [true, allRuleResults];
        } catch (e) {
            e.logged = true;
            this.logger.warn(`Running rules failed due to uncaught exception`, e);
            throw e;
        }
    }

    async runActions(item: Submission | Comment, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<Action[]> {
        const dr = runtimeDryrun || this.dryRun;
        this.logger.debug(`${dr ? 'DRYRUN - ' : ''}Running Actions`);
        const runActions: Action[] = [];
        for (const a of this.actions) {
            if(!a.enabled) {
                this.logger.info(`Action ${a.getActionUniqueName()} not run because it is not enabled.`);
                continue;
            }
            try {
                await a.handle(item, ruleResults, runtimeDryrun);
                runActions.push(a);
            } catch (err) {
                this.logger.error(`Action ${a.getActionUniqueName()} encountered an error while running`, err);
            }
        }
        this.logger.info(`${dr ? 'DRYRUN - ' : ''}Ran Actions: ${runActions.map(x => x.getActionUniqueName()).join(' | ')}`);
        return runActions;
    }
}

export interface ICheck extends JoinCondition, ChecksActivityState {
    /**
     * Friendly name for this Check EX "crosspostSpamCheck"
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * @examples ["myNewCheck"]
     * */
    name: string,
    /**
     * @examples ["A short description of what this check looks for and actions it performs"]
     * */
    description?: string,

    /**
     * Use this option to override the `dryRun` setting for all of its `Actions`
     * @examples [false, true]
     * */
    dryRun?: boolean;

    /**
     * A list of criteria to test the state of the `Activity` against before running the check.
     *
     * If any set of criteria passes the Check will be run. If the criteria fails then the Check will fail.
     *
     * * @examples [[{"over_18": true, "removed': false}]]
     * */
    itemIs?: TypedActivityStates

    /**
     * If present then these Author criteria are checked before running the Check. If criteria fails then the Check will fail.
     * */
    authorIs?: AuthorOptions

    /**
     * Should this check be run by the bot?
     *
     * @default true
     * @examples [true]
     * */
    enable?: boolean,
}

export interface CheckOptions extends ICheck {
    rules: Array<IRuleSet | IRule>
    actions: ActionConfig[]
    logger: Logger
    subredditName: string
    notifyOnTrigger?: boolean
}

export interface CheckJson extends ICheck {
    /**
     * The type of event (new submission or new comment) this check should be run against
     * @examples ["submission", "comment"]
     */
    kind: 'submission' | 'comment'
    /**
     * A list of Rules to run.
     *
     * If `Rule` objects are triggered based on `condition` then `actions` will be performed.
     *
     * Can be `Rule`, `RuleSet`, or the `name` of any **named** `Rule` in your subreddit's configuration.
     *
     * **If `rules` is an empty array or not present then `actions` are performed immediately.**
     * */
    rules?: Array<RuleSetJson | RuleJson>
    /**
     * The `Actions` to run after the check is successfully triggered. ALL `Actions` will run in the order they are listed
     *
     *  Can be `Action` or the `name` of any **named** `Action` in your subreddit's configuration
     *
     * @minItems 1
     * @examples [[{"kind": "comment", "content": "this is the content of the comment", "distinguish": true}, {"kind": "lock"}]]
     * */
    actions: Array<ActionTypeJson>

    /**
     * If notifications are configured and this is `true` then an `eventActioned` event will be sent when this check is triggered.
     *
     * @default false
     * */
    notifyOnTrigger?: boolean,
}

export interface SubmissionCheckJson extends CheckJson {
    kind: 'submission'
    itemIs?: SubmissionState[]
}

/**
 * Cache the result of this check based on the comment author and the submission id
 *
 * This is useful in this type of scenario:
 *
 * 1. This check is configured to run on comments for specific submissions with high volume activity
 * 2. The rules being run are not dependent on the content of the comment
 * 3. The rule results are not likely to change while cache is valid
 * */
export interface UserResultCacheOptions {
    enable?: boolean,
    /**
     * The amount of time, in seconds, to cache this result
     *
     * @default 60
     * @examples [60]
     * */
    ttl?: number,
}

export const userResultCacheDefault: Required<UserResultCacheOptions> = {
    enable: false,
    ttl: 60,
}

export interface CommentCheckJson extends CheckJson {
    kind: 'comment'
    itemIs?: CommentState[]
    cacheUserResult?:  UserResultCacheOptions
}

export type CheckStructuredJson = SubmissionCheckStructuredJson | CommentCheckStructuredJson;
// export interface CheckStructuredJson extends CheckJson {
//     rules: Array<RuleSetObjectJson | RuleObjectJson>
//     actions: Array<ActionObjectJson>
// }

export interface SubmissionCheckStructuredJson extends SubmissionCheckJson {
    rules: Array<RuleSetObjectJson | RuleObjectJson>
    actions: Array<ActionObjectJson>
}

export interface CommentCheckStructuredJson extends CommentCheckJson {
    rules: Array<RuleSetObjectJson | RuleObjectJson>
    actions: Array<ActionObjectJson>
}
