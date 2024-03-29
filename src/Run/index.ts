import {
    ActivityCheckConfigHydratedData,
    ActivityCheckConfigValue, ActivityCheckObject,
    asStructuredCommentCheckJson,
    asStructuredSubmissionCheckJson,
    Check,
} from "../Check";
import {
    PostBehavior, PostBehaviorOption,
    RunResult
} from "../Common/interfaces";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {Logger} from "winston";
import {determineNewResults, isSubmission, mergeArr, normalizeName} from "../util";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";
import Submission from "snoowrap/dist/objects/Submission";
import {Comment} from "snoowrap";
import {runCheckOptions} from "../Subreddit/Manager";
import EventEmitter from "events";
import {CheckProcessingError, RunProcessingError} from "../Utils/Errors";
import {RunEntity} from "../Common/Entities/RunEntity";
import {RunResultEntity} from "../Common/Entities/RunResultEntity";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {RunnableBase} from "../Common/RunnableBase";
import {RunnableBaseJson, RunnableBaseOptions, StructuredRunnableBase} from "../Common/Infrastructure/Runnable";
import {FilterCriteriaDefaults, FilterCriteriaDefaultsJson} from "../Common/Infrastructure/Filters/FilterShapes";
import {IncludesData} from "../Common/Infrastructure/Includes";

export class Run extends RunnableBase {
    name: string;
    submissionChecks: SubmissionCheck[] = [];
    commentChecks: CommentCheck[] = [];
    postFail?: PostBehaviorOption;
    postTrigger?: PostBehaviorOption;
    filterCriteriaDefaults?: FilterCriteriaDefaults
    logger: Logger;
    client: ExtendedSnoowrap;
    subredditName: string;
    dryRun?: boolean;
    enabled: boolean;
    emitter: EventEmitter;
    runEntity!: RunEntity


    constructor(options: RunOptions) {
        super(options);
        const {
            name,
            checks = [],
            emitter,
            postFail,
            postTrigger,
            filterCriteriaDefaults,
            logger,
            client,
            subredditName,
            dryRun,
            enable = true,

        } = options;
        this.name = name;
        this.logger = logger.child({labels: [`RUN ${name}`]}, mergeArr);
        this.client = client;
        this.subredditName = subredditName;
        this.postFail = postFail;
        this.postTrigger = postTrigger;
        this.filterCriteriaDefaults = filterCriteriaDefaults;
        this.dryRun = dryRun;
        this.enabled = enable;
        this.emitter = emitter;

        for(const c of checks) {
            const checkConfig = {
                ...c,
                emitter,
                dryRun: this.dryRun || c.dryRun,
                logger: this.logger,
                subredditName: this.subredditName,
                resources: this.resources,
                client: this.client,
            };
            if (asStructuredCommentCheckJson(checkConfig)) {
                this.commentChecks.push(new CommentCheck(checkConfig));
            } else if (asStructuredSubmissionCheckJson(checkConfig)) {
                this.submissionChecks.push(new SubmissionCheck(checkConfig));
            }
        }
    }

    async initialize() {
        if (this.runEntity === undefined) {
            const runRepo = this.resources.database.getRepository(RunEntity);
            const re = await runRepo.findOne({
                where: {
                    name: this.name,
                    manager: {
                        id: this.resources.managerEntity.id
                    }
                }, relations: {
                    manager: true
                }
            });
            if(re !== null) {
                this.runEntity = re;
            } else {
                this.runEntity = await runRepo.save(new RunEntity({name: this.name, manager: this.resources.managerEntity}));
            }
        }
        for(const c of this.commentChecks) {
            c.runEntity = this.runEntity;
        }
        for(const c of this.submissionChecks) {
            c.runEntity = this.runEntity;
        }
    }

    async handle(activity: (Submission | Comment), initAllRuleResults: RuleResultEntity[], existingRunResults: RunResultEntity[] = [], options: runCheckOptions): Promise<[RunResultEntity, string]> {

        const runResultEnt = new RunResultEntity({run: this.runEntity});
        runResultEnt.checkResults = [];

        let allRuleResults = initAllRuleResults;
        let continueRunIteration = true;
        let postBehavior = 'next';
        const runResult: RunResult = {
            name: this.name,
            triggered: false,
            checkResults: [],
        }
        const {
            maxGotoDepth = 1,
            gotoContext: optGotoContext = '',
            source,
        } = options;

        if(!this.enabled) {
            runResultEnt.reason = 'Not enabled';
            runResult.error = 'Not enabled';
            return [runResultEnt, postBehavior];
        }

        if (isSubmission(activity)) {
            if (this.submissionChecks.length === 0) {
                const msg = 'Skipping b/c Run did not contain any submission Checks';
                this.logger.debug(msg);
                runResultEnt.reason = msg;
                return [runResultEnt, postBehavior];
            }
        } else if (this.commentChecks.length === 0) {
            const msg = 'Skipping b/c Run did not contain any comment Checks';
            this.logger.debug(msg);
            runResultEnt.reason = msg;
            return [runResultEnt, postBehavior];
        }

        let gotoContext = optGotoContext;
        const checks = isSubmission(activity) ? this.submissionChecks : this.commentChecks;
        let continueCheckIteration = true;
        let checkIndex = 0;

        // for now disallow the same goto from being run twice
        // maybe in the future this can be user-configurable
        const hitGotos: string[] = [];

        try {

            const filterResults = await this.runFilters(activity, options);
            const [itemRes, authorRes] = filterResults;
            runResult.itemIs = itemRes;
            runResultEnt.itemIs = itemRes;
            runResult.authorIs = authorRes;
            runResultEnt.authorIs = authorRes;

            const filtersPassed = filterResults.every(x => x === undefined || x.passed);
            if(!filtersPassed) {
                return [runResultEnt, postBehavior];
            }

            while (continueCheckIteration && (checkIndex < checks.length || gotoContext !== '')) {
                let check: Check;
                if (gotoContext !== '') {
                    const [runName, checkName] = gotoContext.split('.');
                    hitGotos.push(checkName);
                    if(hitGotos.filter(x => x === gotoContext).length > maxGotoDepth) {
                        throw new Error(`The check specified in goto "${gotoContext}" has been triggered ${hitGotos.filter(x => x === gotoContext).length} times which is more than the max allowed for any single goto (${maxGotoDepth}).
                         This indicates a possible endless loop may occur so CM will terminate processing this activity to save you from yourself! The max triggered depth can be configured by the operator.`);
                    }
                    const gotoIndex = checks.findIndex(x => normalizeName(x.name) === normalizeName(checkName));
                    if (gotoIndex !== -1) {
                        if (gotoIndex > checkIndex) {
                            this.logger.debug(`Fast forwarding Check iteration to ${checks[gotoIndex].name}`, {leaf: 'GOTO'});
                        } else if (gotoIndex < checkIndex) {
                            this.logger.debug(`Rewinding Check iteration to ${checks[gotoIndex].name}`, {leaf: 'GOTO'});
                        } else if(checkIndex !== 0) {
                            this.logger.debug(`Did not iterate to next Check due to GOTO specifying same Check (you probably don't want to do this!)`, {leaf: 'GOTO'});
                        }
                        check = checks[gotoIndex];
                        checkIndex = gotoIndex;
                        gotoContext = '';
                    } else {
                        throw new Error(`GOTO specified a Check that could not be found in ${isSubmission(activity) ? 'Submission' : 'Comment'} checks: ${checkName}`);
                    }
                } else {
                    check = checks[checkIndex];
                }

                if(existingRunResults.some(x => x.checkResults?.map(y => y.check.name).includes(check.name))) {
                    throw new Error(`The check "${check.name}" has already been run once. This indicates a possible endless loop may occur so CM will terminate processing this activity to save you from yourself!`);
                }

                const checkSummary = await check.handle(activity, allRuleResults, options);
                postBehavior = checkSummary.postBehavior;

                allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, checkSummary.allRuleResults ?? []));

                runResultEnt.checkResults.push(checkSummary);

                //runResult.checkResults.push(checkSummary);

                switch (checkSummary.postBehavior.toLowerCase()) {
                    case 'next':
                        checkIndex++;
                        gotoContext = '';
                        break;
                    case 'nextrun':
                        continueCheckIteration = false;
                        gotoContext = '';
                        break;
                    case 'stop':
                        continueCheckIteration = false;
                        continueRunIteration = false;
                        gotoContext = '';
                        break;
                    default:
                        if (checkSummary.postBehavior.includes('goto:')) {
                            gotoContext = checkSummary.postBehavior.split(':')[1];
                            if (!gotoContext.includes('.')) {
                                // no period means we are going directly to a run
                                continueCheckIteration = false;
                            } else {
                                const [runN, checkN] = gotoContext.split('.');
                                if (runN !== '') {
                                    // if run name is specified then also break check iteration
                                    // OTHERWISE this is a special "in run" check path IE .check1 where we just want to continue iterating checks
                                    continueCheckIteration = false;
                                }
                            }
                        }
                }
            }
            runResultEnt.triggered = runResultEnt.checkResults.some(x => x.triggered);
            runResult.triggered = runResult.checkResults.some(x => x.triggered);
            return [runResultEnt, postBehavior]
        } catch (err: any) {
            if(err instanceof CheckProcessingError && err.result !== undefined) {
                runResultEnt.checkResults.push(err.result);
                //runResult.checkResults.push(err.result);
            }
            if(runResult.error === undefined) {
                runResultEnt.error = `Run failed due to uncaught exception: ${err.message}`;
                runResult.error = `Run failed due to uncaught exception: ${err.message}`;
            }
            runResultEnt.triggered = runResult.checkResults.some(x => x.triggered);
            runResult.triggered = runResult.checkResults.some(x => x.triggered);

            throw new RunProcessingError(`[RUN ${this.name}] An uncaught exception occurred while processing Run`, {cause: err}, runResultEnt);
        }
    }
}

export interface IRun extends PostBehavior, RunnableBaseJson {
    /**
     * Friendly name for this Run EX "flairsRun"
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * @examples ["myNewRun"]
     * */
    name?: string
    /**
     * Set the default filter criteria for all checks. If this property is specified it will override any defaults passed from the bot's config
     *
     * Default behavior is to exclude all mods and automoderator from checks
     * */
    filterCriteriaDefaults?: FilterCriteriaDefaultsJson

    /**
     * Use this option to override the `dryRun` setting for all Actions of all Checks in this Run
     *
     * @examples [false, true]
     * */
    dryRun?: boolean;

    /**
     * Should this Run be executed by the bot?
     *
     * @default true
     * @examples [true]
     * */
    enable?: boolean,
}

export interface RunOptions extends RunConfigObject, RunnableBaseOptions {
    // submissionChecks?: SubmissionCheck[]
    // commentChecks?: CommentCheck[]
    //checks: CheckStructuredJson[]
    name: string
    //logger: Logger
    //resources: SubredditResources
    client: ExtendedSnoowrap
    subredditName: string;
    emitter: EventEmitter;
}

export interface RunConfigData extends IRun {
    checks: ActivityCheckConfigValue[]
}

export type RunConfigValue = string | IncludesData | RunConfigData;

export interface RunConfigHydratedData extends IRun {
    checks: ActivityCheckConfigHydratedData[]
}

export interface RunConfigObject extends Omit<RunConfigHydratedData, 'authorIs' | 'itemIs'>, StructuredRunnableBase {
    checks: ActivityCheckObject[]
    filterCriteriaDefaults?: FilterCriteriaDefaults
}
