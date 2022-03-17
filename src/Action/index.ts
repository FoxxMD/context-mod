import {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {RuleResult} from "../Rule";
import {checkAuthorFilter, checkItemFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {
    ActionProcessResult,
    ActionResult,
    ChecksActivityState,
    ObjectPremise,
    TypedActivityStates
} from "../Common/interfaces";
import Author, {AuthorOptions} from "../Author/Author";
import {mergeArr} from "../util";
import LoggedError from "../Utils/LoggedError";
import {ExtendedSnoowrap} from '../Utils/SnoowrapClients';
import {ErrorWithCause} from "pony-cause";
import EventEmitter from "events";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTypes} from "../Common/types";

export abstract class Action {
    name?: string;
    logger: Logger;
    resources: SubredditResources;
    client: ExtendedSnoowrap;
    authorIs: AuthorOptions;
    itemIs: TypedActivityStates;
    dryRun: boolean;
    enabled: boolean;
    managerEmitter: EventEmitter;

    constructor(options: ActionOptions) {
        const {
            enable = true,
            name = this.getKind(),
            resources,
            client,
            logger,
            subredditName,
            dryRun = false,
            authorIs: {
                excludeCondition = 'OR',
                include = [],
                exclude = [],
            } = {},
            itemIs = [],
            emitter,
        } = options;

        this.name = name;
        this.dryRun = dryRun;
        this.enabled = enable;
        this.resources = resources;
        this.client = client;
        this.logger = logger.child({labels: [`Action ${this.getActionUniqueName()}`]}, mergeArr);
        this.managerEmitter = emitter;

        this.authorIs = {
            excludeCondition,
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }

        this.itemIs = itemIs;
    }

    abstract getKind(): string;

    getActionUniqueName() {
        return this.name === this.getKind() ? this.getKind() : `${this.getKind()} - ${this.name}`;
    }

    protected abstract getSpecificPremise(): object;

    getPremise(): ObjectPremise {
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

    async handle(item: Comment | Submission, ruleResults: RuleResult[], options: runCheckOptions): Promise<ActionResult> {
        const {dryRun: runtimeDryrun} = options;
        const dryRun = runtimeDryrun || this.dryRun;

        let actRes: ActionResult = {
            kind: this.getKind(),
            name: this.getActionUniqueName(),
            run: false,
            dryRun,
            success: false,
            premise: this.getPremise(),
        };
        try {
            const [itemPass, itemFilterType, itemFilterResults] = await checkItemFilter(item, this.itemIs, this.resources, this.logger, options.source);
            if (!itemPass) {
                this.logger.verbose(`Activity did not pass 'itemIs' test, Action not run`);
                actRes.runReason = `Activity did not pass 'itemIs' test, Action not run`;
                actRes.itemIs = itemFilterResults;
                return actRes;
            } else if(this.itemIs.length > 0) {
                actRes.itemIs = itemFilterResults;
            }

            const [authPass, authFilterType, authorFilterResult] = await checkAuthorFilter(item, this.authorIs, this.resources, this.logger);
            if(!authPass) {
                this.logger.verbose(`${authFilterType} author criteria not matched, Action not run`);
                actRes.runReason = `${authFilterType} author criteria not matched`;
                actRes.authorIs = authorFilterResult;
                return actRes;
            } else if(authFilterType !== undefined) {
                actRes.authorIs = authorFilterResult;
            }

            actRes.run = true;
            const results = await this.process(item, ruleResults, runtimeDryrun);
            return {...actRes, ...results};
        } catch (err: any) {
            if(!(err instanceof LoggedError)) {
                const actionError = new ErrorWithCause('Action did not run successfully due to unexpected error', {cause: err});
                this.logger.error(actionError);
            }
            actRes.success = false;
            actRes.result = err.message;
            return actRes;
        }
    }

    abstract process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryun?: boolean): Promise<ActionProcessResult>;
}

export interface ActionOptions extends ActionConfig {
    logger: Logger;
    subredditName: string;
    resources: SubredditResources;
    client: ExtendedSnoowrap;
    emitter: EventEmitter
}

export interface ActionConfig extends ChecksActivityState {
    /**
     * An optional, but highly recommended, friendly name for this Action. If not present will default to `kind`.
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * @examples ["myDescriptiveAction"]
     * */
    name?: string;
    /**
     * If `true` the Action will not make the API request to Reddit to perform its action.
     *
     * @default false
     * @examples [false, true]
     * */
    dryRun?: boolean;

    /**
     * If present then these Author criteria are checked before running the Action. If criteria fails then the Action is not run.
     * */
    authorIs?: AuthorOptions

    /**
     * A list of criteria to test the state of the `Activity` against before running the Action.
     *
     * If any set of criteria passes the Action will be run.
     *
     * */
    itemIs?: TypedActivityStates

    /**
     * If set to `false` the Action will not be run
     *
     * @default true
     * @examples [true]
     * */
    enable?: boolean
}

export interface ActionJson extends ActionConfig {
    /**
     * The type of action that will be performed
     */
    kind: ActionTypes
}

export const isActionJson = (obj: object): obj is ActionJson => {
    return (obj as ActionJson).kind !== undefined;
}

export default Action;

