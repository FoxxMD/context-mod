import {RuleSet, IRuleSet, RuleSetJson, RuleSetObjectJson} from "../Rule/RuleSet";
import {IRule, isRuleSetResult, Rule, RuleJSONConfig, RuleResult, RuleSetResult} from "../Rule";
import Action, {ActionConfig, ActionJson} from "../Action";
import {Logger} from "winston";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {actionFactory} from "../Action/ActionFactory";
import {ruleFactory} from "../Rule/RuleFactory";
import {
    boolToString,
    createAjvFactory, determineNewResults,
    FAIL,
    mergeArr,
    PASS,
    resultsSummary,
    ruleNamesFromResults,
    truncateStringToLength
} from "../util";
import {
    ActionResult, ActivityType, CheckResult,
    ChecksActivityState, CheckSummary,
    CommentState,
    JoinCondition,
    JoinOperands, NotificationEventPayload, PostBehavior, PostBehaviorTypes,
    SubmissionState,
    TypedActivityStates, UserResultCache
} from "../Common/interfaces";
import * as RuleSchema from '../Schema/Rule.json';
import * as RuleSetSchema from '../Schema/RuleSet.json';
import * as ActionSchema from '../Schema/Action.json';
import {ActionObjectJson, RuleJson, RuleObjectJson, ActionJson as ActionTypeJson} from "../Common/types";
import {checkAuthorFilter, checkItemFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {Author, AuthorCriteria, AuthorOptions} from '..';
import {ExtendedSnoowrap} from '../Utils/SnoowrapClients';
import {CheckProcessingError, isRateLimitError} from "../Utils/Errors";
import {ErrorWithCause, stackWithCauses} from "pony-cause";
import {runCheckOptions} from "../Subreddit/Manager";
import EventEmitter from "events";
import {itemContentPeek} from "../Utils/SnoowrapUtils";

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
    authorIs: AuthorOptions;
    cacheUserResult: Required<UserResultCacheOptions>;
    dryRun?: boolean;
    notifyOnTrigger: boolean;
    resources: SubredditResources;
    client: ExtendedSnoowrap;
    postTrigger: PostBehaviorTypes;
    postFail: PostBehaviorTypes;
    emitter: EventEmitter;

    constructor(options: CheckOptions) {
        const {
            emitter,
            enable = true,
            name,
            resources,
            description,
            client,
            condition = 'AND',
            rules = [],
            actions = [],
            notifyOnTrigger = false,
            subredditName,
            cacheUserResult = {},
            postTrigger = 'nextRun',
            postFail = 'next',
            itemIs = [],
            authorIs: {
                include = [],
                excludeCondition,
                exclude = [],
            } = {},
            dryRun,
        } = options;

        this.enabled = enable;
        this.emitter = emitter;

        this.logger = options.logger.child({labels: [`CHK ${checkLogName(name)}`]}, mergeArr);

        const ajv = createAjvFactory(this.logger);

        this.resources = resources;
        this.client = client;

        this.name = name;
        this.description = description;
        this.notifyOnTrigger = notifyOnTrigger;
        this.condition = condition;
        this.itemIs = itemIs;
        this.authorIs = {
            excludeCondition,
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }
        this.postTrigger = postTrigger;
        this.postFail = postFail;
        this.cacheUserResult = {
            ...userResultCacheDefault,
            ...cacheUserResult
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
                    this.rules.push(new RuleSet({...ruleConfig, logger: this.logger, subredditName, resources: this.resources, client: this.client}));
                } else {
                    setErrors = ajv.errors;
                    valid = ajv.validate(RuleSchema, r);
                    if (valid) {
                        this.rules.push(ruleFactory(r as RuleJSONConfig, this.logger, subredditName, this.resources, this.client));
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
                    }, this.logger, subredditName, this.resources, this.client, this.emitter));
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
        if (this.rules.length === 0 && this.itemIs.length === 0 && this.authorIs.exclude?.length === 0 && this.authorIs.include?.length === 0) {
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

    async getCacheResult(item: Submission | Comment) : Promise<UserResultCache | undefined> {
        return undefined;
    }

    async setCacheResult(item: Submission | Comment, result: UserResultCache): Promise<void> {
    }

    async handle(activity: (Submission | Comment), allRuleResults: RuleResult[], options: runCheckOptions): Promise<CheckSummary> {

        let checkSum: CheckSummary = {
            name: this.name,
            run: this.name,
            actionResults: [],
            ruleResults: [],
            postBehavior: 'next',
            fromCache: false,
            triggered: false,
            condition: this.condition
        }

        let currentResults: RuleResult[] = [];

        try {
            if (!this.enabled) {
                checkSum.error = 'Not enabled';
                this.logger.info(`Not enabled, skipping...`);
                return checkSum;
            }
            //checksRunNames.push(check.name);
            //checksRun++;
            let triggered = false;
            let runActions: ActionResult[] = [];
            let checkRes: CheckResult;
            let checkError: string | undefined;
            try {
                checkRes = await this.runRules(activity, allRuleResults, options);

                checkSum = {
                    ...checkSum,
                    ...checkRes,
                }
                const {
                    triggered: checkTriggered,
                    ruleResults: checkResults,
                    fromCache = false
                } = checkRes;
                //isFromCache = fromCache;
                if (!fromCache) {
                    await this.setCacheResult(activity, {result: checkTriggered, ruleResults: checkResults});
                } else {
                    checkRes.fromCache = true;
                    //cachedCheckNames.push(check.name);
                }
                currentResults = checkResults;
                //totalRulesRun += checkResults.length;
                // allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, checkResults));
                if (triggered && fromCache && !this.cacheUserResult.runActions) {
                    this.logger.info('Check was triggered but cache result options specified NOT to run actions...counting as check NOT triggered');
                    checkSum.triggered = false;
                    triggered = false;
                }
            } catch (err: any) {
                checkSum.error = `Running rules failed due to uncaught exception: ${err.message}`;
                const chkLogError = new ErrorWithCause(`[CHK ${this.name}] Running rules failed due to uncaught exception`, {cause: err});
                if (err.logged !== true) {
                    this.logger.warn(chkLogError);
                }
                this.emitter.emit('error', chkLogError);
            }

            let behaviorT: string;

            if (checkSum.triggered) {
                try {
                    checkSum.postBehavior = this.postTrigger;

                    checkSum.actionResults = await this.runActions(activity, currentResults.filter(x => x.triggered), options);
                    // we only can about report and comment actions since those can produce items for newComm and modqueue
                    const recentCandidates = checkSum.actionResults.filter(x => ['report', 'comment'].includes(x.kind.toLocaleLowerCase())).map(x => x.touchedEntities === undefined ? [] : x.touchedEntities).flat();
                    for (const recent of recentCandidates) {
                        await this.resources.setRecentSelf(recent as (Submission | Comment));
                    }
                    //actionsRun = runActions.length;

                    if (this.notifyOnTrigger) {
                        const ar = checkSum.actionResults.filter(x => x.success).map(x => x.name).join(', ');
                        const [peek, _] = await itemContentPeek(activity);
                        const notifPayload: NotificationEventPayload = {
                            type: 'eventActioned',
                            title: 'Check Triggered',
                            body: `Check "${this.name}" was triggered on Event: \n\n ${peek} \n\n with the following actions run: ${ar}`
                        }
                        this.emitter.emit('notify', notifPayload)
                    }
                } catch (err: any) {
                    this.emitter.emit('error', err);
                    checkSum.error = `Running actions failed due to uncaught exception: ${err.message}`;
                    if (err.logged !== true) {
                        const chkLogError = new ErrorWithCause(`[CHK ${this.name}] Running actions failed due to uncaught exception`, {cause: err});
                        this.logger.warn(chkLogError);
                    }
                }
            } else {
                checkSum.postBehavior = this.postFail;
            }

            behaviorT = checkSum.triggered ? 'Trigger' : 'Fail';

            switch (checkSum.postBehavior.toLowerCase()) {
                case 'next':
                    this.logger.debug('Behavior => NEXT => Run next check', {leaf: `Post Check ${behaviorT}`});
                    break;
                case 'nextrun':
                    this.logger.debug('Behavior => NEXT RUN => Skip remaining checks and go to next Run', {leaf: `Post Check ${behaviorT}`});
                    break;
                case 'stop':
                    this.logger.debug('Behavior => STOP => Immediately stop current Run and skip all remaining runs', {leaf: `Post Check ${behaviorT}`});
                    break;
                default:
                    if (checkSum.postBehavior.includes('goto:')) {
                        const gotoContext = checkSum.postBehavior.split(':')[1];
                        this.logger.debug(`Behavior => GOTO => ${gotoContext}`, {leaf: `Post Check ${behaviorT}`});
                    } else {
                        throw new Error(`Post ${behaviorT} Behavior "${checkSum.postBehavior}" was not a valid value. Must be one of => next | nextRun | stop | goto:[path]`);
                    }
            }
            return checkSum;
        } catch (err: any) {
            if(checkSum.error === undefined) {
                checkSum.error = stackWithCauses(err);
            }
            throw new CheckProcessingError(`[CHK ${this.name}] An uncaught exception occurred while processing Check`, {cause: err}, checkSum);
        } finally {
            this.resources.updateHistoricalStats({
                checksTriggered: checkSum.triggered ? [checkSum.name] : [],
                checksRun: [checkSum.name],
                checksFromCache: checkSum.fromCache ? [checkSum.name] : [],
                actionsRun: checkSum.actionResults.map(x => x.name),
                rulesRun: checkSum.ruleResults.map(x => x.name),
                rulesTriggered: checkSum.ruleResults.filter(x => x.triggered).map(x => x.name),
                rulesCachedTotal: checkSum.ruleResults.filter(x => x.fromCache).length
            })
        }
    }

    async runRules(item: Submission | Comment, existingResults: RuleResult[] = [], options: runCheckOptions): Promise<CheckResult> {
        try {
            let allRuleResults: RuleResult[] = [];
            let allResults: (RuleResult | RuleSetResult)[] = [];

            const checkResult: CheckResult = {
                triggered: false,
                ruleResults: [],
            }

            // check cache results
            const cacheResult = await this.getCacheResult(item);
            if(cacheResult !== undefined) {
                this.logger.verbose(`Skipping rules run because result was found in cache, Check Triggered Result: ${cacheResult}`);
                return {
                    triggered: cacheResult.result,
                    ruleResults: cacheResult.ruleResults,
                    fromCache: true
                };
            }

            const [itemPass, itemFilterType, itemFilterResults] = await checkItemFilter(item, this.itemIs, this.resources, this.logger, options.source);
            if (!itemPass) {
                return {
                    triggered: false,
                    ruleResults: allRuleResults,
                    itemIs: itemFilterResults
                };
            } else if(this.itemIs.length > 0) {
                checkResult.itemIs = itemFilterResults;
            }
            const [authPass, authFilterType, authorFilterResults] = await checkAuthorFilter(item, this.authorIs, this.resources, this.logger);
            if(!authPass) {
                return {
                    triggered: false,
                    ruleResults: allRuleResults,
                    authorIs: authorFilterResults
                };
            } else if(authFilterType !== undefined) {
                checkResult.authorIs = authorFilterResults;
            }

            if (this.rules.length === 0) {
                this.logger.info(`${PASS} => No rules to run, check auto-passes`);
                return {
                    triggered: true,
                    ruleResults: allRuleResults,
                };
            }

            let runOne = false;
            for (const r of this.rules) {
                //let results: RuleResult | RuleSetResult;
                const combinedResults = [...existingResults, ...allRuleResults];
                const [passed, results] = await r.run(item, combinedResults, options);
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
                        return {
                            triggered: true,
                            ruleResults: allRuleResults,
                        };
                    }
                } else if (this.condition === 'AND') {
                    this.logger.verbose(`${FAIL} => Rules: ${resultsSummary(allResults, this.condition)}`);
                    return {
                        triggered: false,
                        ruleResults: allRuleResults,
                    };
                }
            }
            if (!runOne) {
                this.logger.verbose(`${FAIL} => All Rules skipped because of Author checks or itemIs tests`);
                return {
                    triggered: false,
                    ruleResults: allRuleResults,
                };
            } else if (this.condition === 'OR') {
                // if OR and did not return already then none passed
                this.logger.verbose(`${FAIL} => Rules: ${resultsSummary(allResults, this.condition)}`);
                return {
                    triggered: false,
                    ruleResults: allRuleResults,
                };
            }
            // otherwise AND and did not return already so all passed
            this.logger.info(`${PASS} => Rules: ${resultsSummary(allResults, this.condition)}`);
            return {
                triggered: true,
                ruleResults: allRuleResults,
            };
        } catch (e: any) {
            throw new ErrorWithCause('Running rules failed due to error', {cause: e});
        }
    }

    async runActions(item: Submission | Comment, ruleResults: RuleResult[], options: runCheckOptions): Promise<ActionResult[]> {
        const {dryRun} = options;
        const dr = dryRun || this.dryRun;
        this.logger.debug(`${dr ? 'DRYRUN - ' : ''}Running Actions`);
        const runActions: ActionResult[] = [];
        for (const a of this.actions) {
            if(!a.enabled) {
                runActions.push({
                    kind: a.getKind(),
                    name: a.getActionUniqueName(),
                    run: false,
                    success: false,
                    runReason: 'Not enabled',
                    dryRun: (a.dryRun || dr) || false,
                });
                this.logger.info(`Action ${a.getActionUniqueName()} not run because it is not enabled.`);
                continue;
            }
            const res = await a.handle(item, ruleResults, options);
            runActions.push(res);
        }
        this.logger.info(`${dr ? 'DRYRUN - ' : ''}Ran Actions: ${runActions.map(x => x.name).join(' | ')}`);
        return runActions;
    }
}

export interface ICheck extends JoinCondition, ChecksActivityState, PostBehavior {
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
    rules: Array<IRuleSet | IRule>;
    actions: ActionConfig[];
    logger: Logger;
    subredditName: string;
    notifyOnTrigger?: boolean;
    resources: SubredditResources;
    client: ExtendedSnoowrap;
    cacheUserResult?: UserResultCacheOptions;
    emitter: EventEmitter
}

export interface CheckJson extends ICheck {
    /**
     * The type of event (new submission or new comment) this check should be run against
     * @examples ["submission", "comment"]
     */
    kind: ActivityType
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
     * @examples [[{"kind": "comment", "content": "this is the content of the comment", "distinguish": true}, {"kind": "lock"}]]
     * */
    actions?: Array<ActionTypeJson>

    /**
     * If notifications are configured and this is `true` then an `eventActioned` event will be sent when this check is triggered.
     *
     * @default false
     * */
    notifyOnTrigger?: boolean,

    cacheUserResult?: UserResultCacheOptions;
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
    /**
    * @default false
    * */
    enable?: boolean,
    /**
     * The amount of time, in seconds, to cache this result
     *
     * @default 60
     * @examples [60]
     * */
    ttl?: number,
    /**
     * In the event the cache returns a triggered result should the actions for the check also be run?
     *
     * @default true
     * */
    runActions?: boolean
}

export const userResultCacheDefault: Required<UserResultCacheOptions> = {
    enable: false,
    ttl: 60,
    runActions: true,
}

export interface CommentCheckJson extends CheckJson {
    kind: 'comment'
    itemIs?: CommentState[]
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
