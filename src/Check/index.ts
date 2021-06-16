import {RuleSet, IRuleSet, RuleSetJson, RuleSetObjectJson} from "../Rule/RuleSet";
import {Author, AuthorOptions, IRule, Rule, RuleJSONConfig, RuleResult} from "../Rule";
import Action, {ActionConfig, ActionJson} from "../Action";
import {Logger} from "winston";
import {Comment, Submission} from "snoowrap";
import {actionFactory} from "../Action/ActionFactory";
import {ruleFactory} from "../Rule/RuleFactory";
import {createAjvFactory, mergeArr, ruleNamesFromResults} from "../util";
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
import {isItem} from "../Utils/SnoowrapUtils";
import ResourceManager, {SubredditResources} from "../Subreddit/SubredditResources";

export class Check implements ICheck {
    actions: Action[] = [];
    description?: string;
    name: string;
    condition: JoinOperands;
    rules: Array<RuleSet | Rule> = [];
    logger: Logger;
    itemIs: TypedActivityStates;
    authorIs: AuthorOptions;
    dryRun?: boolean;
    resources: SubredditResources;

    constructor(options: CheckOptions) {
        const {
            name,
            description,
            condition = 'AND',
            rules = [],
            actions = [],
            subredditName,
            itemIs = [],
            authorIs: {
                include = [],
                exclude = [],
            } = {},
            dryRun,
        } = options;

        this.logger = options.logger.child({labels: [`Check ${name}`]}, mergeArr);

        const ajv = createAjvFactory(this.logger);

        this.resources = ResourceManager.get(subredditName) as SubredditResources;

        this.name = name;
        this.description = description;
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
                    this.actions.push(actionFactory({...aj, dryRun: this.dryRun || aj.dryRun}, this.logger, subredditName));
                    // @ts-ignore
                    a.logger = this.logger;
                } else {
                    this.logger.warn('Could not parse object as Action', {}, {error: ajv.errors, obj: a})
                }
            }
        }


    }

    async run(item: Submission | Comment, existingResults: RuleResult[] = []): Promise<[boolean, RuleResult[]]> {
        let allResults: RuleResult[] = [];
        const [itemPass, crit] = isItem(item, this.itemIs, this.logger);
        if(!itemPass) {
            this.logger.info(`❌ => Item did not pass 'itemIs' test`);
            return [false, allResults];
        }
        let authorPass = null;
        if (this.authorIs.include !== undefined && this.authorIs.include.length > 0) {
            for (const auth of this.authorIs.include) {
                if (await this.resources.testAuthorCriteria(item, auth)) {
                    authorPass = true;
                    break;
                }
            }
            if(!authorPass) {
                this.logger.verbose('❌ => Inclusive author criteria not matched');
                return Promise.resolve([false, allResults]);
            }
        }
        if (authorPass === null && this.authorIs.exclude !== undefined && this.authorIs.exclude.length > 0) {
            for (const auth of this.authorIs.exclude) {
                if (await this.resources.testAuthorCriteria(item, auth, false)) {
                    authorPass = true;
                    break;
                }
            }
            if(!authorPass) {
                this.logger.verbose('❌ =>  Exclusive author criteria not matched');
                return Promise.resolve([false, allResults]);
            }
        }
        let runOne = false;
        for (const r of this.rules) {
            const combinedResults = [...existingResults, ...allResults];
            const [passed, results] = await r.run(item, combinedResults);
            allResults = allResults.concat(results);
            if (passed === null) {
                continue;
            }
            runOne = true;
            if (passed) {
                if (this.condition === 'OR') {
                    this.logger.info(`✔️ => Rules (OR): ${ruleNamesFromResults(allResults)}`);
                    return [true, allResults];
                }
            } else if (this.condition === 'AND') {
                this.logger.info(`❌ => Rules (AND): ${ruleNamesFromResults(allResults)}`);
                return [false, allResults];
            }
        }
        if (!runOne) {
            this.logger.info('❌ => All Rules skipped because of Author checks or itemIs tests');
            return [false, allResults];
        }
        this.logger.info(`✔️ => Rules (AND) : ${ruleNamesFromResults(allResults)}`);
        return [true, allResults];
    }

    async runActions(item: Submission | Comment, ruleResults: RuleResult[]): Promise<void> {
        this.logger.debug(`${this.dryRun ? 'DRYRUN - ' : ''}Running Actions`);
        for (const a of this.actions) {
            await a.handle(item, ruleResults);
        }
        this.logger.info(`${this.dryRun ? 'DRYRUN - ' : ''}Ran Actions`);
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
     * */
    dryRun?: boolean;

    /**
     * A list of criteria to test the state of the `Activity` against before running the check.
     *
     * If any set of criteria passes the Check will be run. If the criteria fails then the Check will fail.
     * */
    itemIs?: TypedActivityStates

    /**
     * If present then these Author criteria are checked before running the Check. If criteria fails then the Check will fail.
     * */
    authorIs?: AuthorOptions
}

export interface CheckOptions extends ICheck {
    rules: Array<IRuleSet | IRule>
    actions: ActionConfig[]
    logger: Logger
    subredditName: string
}

export interface CheckJson extends ICheck {
    /**
     * The type of event (new submission or new comment) this check should be run against
     * @examples ["submission", "comment"]
     */
    kind: 'submission' | 'comment'
    /**
     * A list of Rules to run. If `Rule` objects are triggered based on `condition` then `Actions` will be performed.
     *
     * Can be `Rule`, `RuleSet`, or the `name` of any **named** `Rule` in your subreddit's configuration
     * @minItems 1
     * */
    rules: Array<RuleSetJson | RuleJson>
    /**
     * The `Actions` to run after the check is successfully triggered. ALL `Actions` will run in the order they are listed
     *
     *  Can be `Action` or the `name` of any **named** `Action` in your subreddit's configuration
     *
     * @minItems 1
     * */
    actions: Array<ActionTypeJson>
}

export interface SubmissionCheckJson extends CheckJson {
    kind: 'submission'
    itemIs?: SubmissionState[]
}

export interface CommentCheckJson extends CheckJson {
    kind: 'comment'
    itemIs?: CommentState[]
}

export type CheckStructuredJson  = SubmissionCheckStructuredJson | CommentCheckStructuredJson;
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
