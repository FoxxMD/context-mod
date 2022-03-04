import {Check, CheckStructuredJson} from "../Check";
import {
    ActionResult,
    ActivityCheckJson, CheckResult, CheckSummary,
    FilterCriteriaDefaults, FilterResult,
    PostBehavior,
    PostBehaviorTypes, RunResult,
    TypedActivityStates
} from "../Common/interfaces";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {Logger} from "winston";
import {determineNewResults, FAIL, isSubmission, mergeArr, normalizeName} from "../util";
import {checkAuthorFilter, checkItemFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";
import {Author, AuthorCriteria, AuthorOptions} from "../Author/Author";
import Submission from "snoowrap/dist/objects/Submission";
import {Comment} from "snoowrap";
import {runCheckOptions} from "../Subreddit/Manager";
import {RuleResult} from "../Rule";
import {ErrorWithCause, stackWithCauses} from "pony-cause";
import EventEmitter from "events";
import {CheckProcessingError, RunProcessingError} from "../Utils/Errors";

export class Run {
    name: string;
    submissionChecks: SubmissionCheck[] = [];
    commentChecks: CommentCheck[] = [];
    postFail?: PostBehaviorTypes;
    postTrigger?: PostBehaviorTypes;
    filterCriteriaDefaults?: FilterCriteriaDefaults
    logger: Logger;
    client: ExtendedSnoowrap;
    subredditName: string;
    resources: SubredditResources;
    dryRun?: boolean;
    itemIs: TypedActivityStates;
    authorIs: AuthorOptions;
    enabled: boolean;
    emitter: EventEmitter;


    constructor(options: RunOptions) {
        const {
            name,
            checks = [],
            emitter,
            postFail,
            postTrigger,
            filterCriteriaDefaults,
            logger,
            resources,
            client,
            subredditName,
            dryRun,
            authorIs: {
                include = [],
                excludeCondition,
                exclude = [],
            } = {},
            itemIs = [],
            enable = true,

        } = options;
        this.name = name;
        this.logger = logger.child({labels: [`RUN ${name}`]}, mergeArr);
        this.resources = resources;
        this.client = client;
        this.subredditName = subredditName;
        this.postFail = postFail;
        this.postTrigger = postTrigger;
        this.filterCriteriaDefaults = filterCriteriaDefaults;
        this.dryRun = dryRun;
        this.enabled = enable;
        this.itemIs = itemIs;
        this.authorIs = {
            excludeCondition,
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }
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
            if (c.kind === 'comment') {
                this.commentChecks.push(new CommentCheck(checkConfig));
            } else if (c.kind === 'submission') {
                this.submissionChecks.push(new SubmissionCheck(checkConfig));
            }
        }
    }

    async handle(activity: (Submission | Comment), initAllRuleResults: RuleResult[], existingRunResults: RunResult[] = [], options: runCheckOptions): Promise<[RunResult, string]> {

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
            runResult.error = 'Not enabled';
            return [runResult, postBehavior];
        }

        if (isSubmission(activity)) {
            if (this.submissionChecks.length === 0) {
                const msg = 'Skipping b/c Run did not contain any submission Checks';
                this.logger.debug(msg);
                return [{...runResult, reason: msg}, postBehavior];
            }
        } else if (this.commentChecks.length === 0) {
            const msg = 'Skipping b/c Run did not contain any comment Checks';
            this.logger.debug(msg);
            return [{...runResult, reason: msg}, postBehavior];
        }

        let gotoContext = optGotoContext;
        const checks = isSubmission(activity) ? this.submissionChecks : this.commentChecks;
        let continueCheckIteration = true;
        let checkIndex = 0;

        // for now disallow the same goto from being run twice
        // maybe in the future this can be user-configurable
        const hitGotos: string[] = [];

        try {

            const [itemPass, itemFilterType, itemFilterResults] = await checkItemFilter(activity, this.itemIs, this.resources, this.logger, source)
            if (!itemPass) {
                this.logger.verbose(`${FAIL} => Item did not pass 'itemIs' test`);
                return [{
                    ...runResult,
                    triggered: false,
                    itemIs: itemFilterResults
                }, postBehavior];
            } else if (this.itemIs.length > 0) {
                runResult.itemIs = itemFilterResults;
            }

            const [authFilterPass, authFilterType, authorFilterResult] = await checkAuthorFilter(activity, this.authorIs, this.resources, this.logger);
            if (!authFilterPass) {
                return [{
                    ...runResult,
                    authorIs: authorFilterResult
                }, postBehavior];
            } else if (authFilterType !== undefined) {
                runResult.authorIs = authorFilterResult;
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

                if(existingRunResults.some(x => x.checkResults?.map(y => y.name).includes(check.name))) {
                    throw new Error(`The check "${check.name}" has already been run once. This indicates a possible endless loop may occur so CM will terminate processing this activity to save you from yourself!`);
                }

                const checkSummary = await check.handle(activity, allRuleResults, options);
                postBehavior = checkSummary.postBehavior;

                allRuleResults = allRuleResults.concat(determineNewResults(allRuleResults, checkSummary.ruleResults));

                runResult.checkResults.push(checkSummary);

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
            runResult.triggered = runResult.checkResults.some(x => x.triggered);
            return [runResult, postBehavior]
        } catch (err: any) {
            if(err instanceof CheckProcessingError && err.result !== undefined) {
                runResult.checkResults.push(err.result);
            }
            if(runResult.error === undefined) {
                runResult.error = `Run failed due to uncaught exception: ${err.message}`;
            }
            runResult.triggered = runResult.checkResults.some(x => x.triggered);

            throw new RunProcessingError(`[RUN ${this.name}] An uncaught exception occurred while processing Run`, {cause: err}, runResult);
        }
    }
}

export interface IRun extends PostBehavior {
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
    filterCriteriaDefaults?: FilterCriteriaDefaults

    /**
     * Use this option to override the `dryRun` setting for all Actions of all Checks in this Run
     *
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
     * Should this Run be executed by the bot?
     *
     * @default true
     * @examples [true]
     * */
    enable?: boolean,
}

export interface RunOptions extends IRun {
    // submissionChecks?: SubmissionCheck[]
    // commentChecks?: CommentCheck[]
    checks: CheckStructuredJson[]
    name: string
    logger: Logger
    resources: SubredditResources
    client: ExtendedSnoowrap
    subredditName: string;
    emitter: EventEmitter;
}

export interface RunJson extends IRun {
    checks: ActivityCheckJson[]
}

export interface RunStructuredJson extends RunJson {
    checks: CheckStructuredJson[]
}
