import {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {RuleResult} from "../Rule";
import {SubredditResources} from "../Subreddit/SubredditResources";
import {ActionProcessResult, ActionResult, ChecksActivityState, TypedActivityStates} from "../Common/interfaces";
import Author, {AuthorOptions} from "../Author/Author";
import {mergeArr} from "../util";
import LoggedError from "../Utils/LoggedError";
import {ExtendedSnoowrap} from '../Utils/SnoowrapClients';

export abstract class Action {
    name?: string;
    logger: Logger;
    resources: SubredditResources;
    client: ExtendedSnoowrap;
    authorIs: AuthorOptions;
    itemIs: TypedActivityStates;
    dryRun: boolean;
    enabled: boolean;

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
                include = [],
                exclude = [],
            } = {},
            itemIs = [],
        } = options;

        this.name = name;
        this.dryRun = dryRun;
        this.enabled = enable;
        this.resources = resources;
        this.client = client;
        this.logger = logger.child({labels: [`Action ${this.getActionUniqueName()}`]}, mergeArr);

        this.authorIs = {
            exclude: exclude.map(x => new Author(x)),
            include: include.map(x => new Author(x)),
        }

        this.itemIs = itemIs;
    }

    abstract getKind(): string;

    getActionUniqueName() {
        return this.name === this.getKind() ? this.getKind() : `${this.getKind()} - ${this.name}`;
    }

    async handle(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionResult> {
        const dryRun = runtimeDryrun || this.dryRun;

        let actRes: ActionResult = {
            kind: this.getKind(),
            name: this.getActionUniqueName(),
            run: false,
            dryRun,
            success: false,
        };
        try {
            const itemPass = await this.resources.testItemCriteria(item, this.itemIs);
            if (!itemPass) {
                this.logger.verbose(`Activity did not pass 'itemIs' test, Action not run`);
                actRes.runReason = `Activity did not pass 'itemIs' test, Action not run`;
                return actRes;
            }
            if (this.authorIs.include !== undefined && this.authorIs.include.length > 0) {
                for (const auth of this.authorIs.include) {
                    if (await this.resources.testAuthorCriteria(item, auth)) {
                        actRes.run = true;
                        const results = await this.process(item, ruleResults, runtimeDryrun);
                        return {...actRes, ...results};
                    }
                }
                this.logger.verbose('Inclusive author criteria not matched, Action not run');
                actRes.runReason = 'Inclusive author criteria not matched';
                return actRes;
            } else if (this.authorIs.exclude !== undefined && this.authorIs.exclude.length > 0) {
                for (const auth of this.authorIs.exclude) {
                    if (await this.resources.testAuthorCriteria(item, auth, false)) {
                        actRes.run = true;
                        const results = await this.process(item, ruleResults, runtimeDryrun);
                        return {...actRes, ...results};
                    }
                }
                this.logger.verbose('Exclusive author criteria not matched, Action not run');
                actRes.runReason = 'Exclusive author criteria not matched';
                return actRes;
            }

            actRes.run = true;
            const results = await this.process(item, ruleResults, runtimeDryrun);
            return {...actRes, ...results};
        } catch (err: any) {
            if(!(err instanceof LoggedError)) {
                this.logger.error(`Encountered error while running`, err);
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
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'approve' | 'ban' | 'flair' | 'usernote' | 'message' | 'userflair'
}

export const isActionJson = (obj: object): obj is ActionJson => {
    return (obj as ActionJson).kind !== undefined;
}

export default Action;

