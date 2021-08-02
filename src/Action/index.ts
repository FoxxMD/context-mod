import {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {RuleResult} from "../Rule";
import ResourceManager, {SubredditResources} from "../Subreddit/SubredditResources";
import {ChecksActivityState, TypedActivityStates} from "../Common/interfaces";
import Author, {AuthorOptions} from "../Author/Author";

export abstract class Action {
    name?: string;
    logger: Logger;
    resources: SubredditResources;
    authorIs: AuthorOptions;
    itemIs: TypedActivityStates;
    dryRun: boolean;

    constructor(options: ActionOptions) {
        const {
            name = this.getKind(),
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
        this.resources = ResourceManager.get(subredditName) as SubredditResources;
        this.logger = logger.child({labels: [`Action ${this.getActionUniqueName()}`]});

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

    async handle(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<void> {
        const dryRun = runtimeDryrun || this.dryRun;
        let actionRun = false;
        const itemPass = await this.resources.testItemCriteria(item, this.itemIs);
        if (!itemPass) {
            this.logger.verbose(`Activity did not pass 'itemIs' test, Action not run`);
            return;
        }
        const authorRun = async () => {
            if (this.authorIs.include !== undefined && this.authorIs.include.length > 0) {
                for (const auth of this.authorIs.include) {
                    if (await this.resources.testAuthorCriteria(item, auth)) {
                        await this.process(item, ruleResults, runtimeDryrun);
                        return true;
                    }
                }
                this.logger.verbose('Inclusive author criteria not matched, Action not run');
                return false;
            }
            if (!actionRun && this.authorIs.exclude !== undefined && this.authorIs.exclude.length > 0) {
                for (const auth of this.authorIs.exclude) {
                    if (await this.resources.testAuthorCriteria(item, auth, false)) {
                        await this.process(item, ruleResults, runtimeDryrun);
                        return true;
                    }
                }
                this.logger.verbose('Exclusive author criteria not matched, Action not run');
                return false;
            }
            return null;
        }
        const authorRunResults = await authorRun();
        if (null === authorRunResults) {
            await this.process(item, ruleResults, runtimeDryrun);
        } else if (!authorRunResults) {
            return;
        }
        this.logger.verbose(`${dryRun ? 'DRYRUN - ' : ''}Done`);
    }

    abstract process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryun?: boolean): Promise<void>;
}

export interface ActionOptions extends ActionConfig {
    logger: Logger;
    subredditName: string;
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
}

export interface ActionJson extends ActionConfig {
    /**
     * The type of action that will be performed
     */
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'approve' | 'ban' | 'flair' | 'usernote' | 'message'
}

export const isActionJson = (obj: object): obj is ActionJson => {
    return (obj as ActionJson).kind !== undefined;
}

export default Action;

