import {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {RuleResult} from "../Rule";
import ResourceManager, {SubredditResources} from "../Subreddit/SubredditResources";

export abstract class Action {
    name?: string;
    logger: Logger;
    resources: SubredditResources;
    dryRun: boolean;

    constructor(options: ActionOptions) {
        const {
            name = this.getKind(),
            logger,
            subredditName,
            dryRun = false,
        } = options;

        this.name = name;
        this.dryRun = dryRun;
        this.resources = ResourceManager.get(subredditName) as SubredditResources;
        this.logger = logger.child({labels: ['Action', this.getActionUniqueName()]});
    }

    abstract getKind(): string;

    getActionUniqueName() {
        return this.name === this.getKind() ? this.getKind() : `${this.getKind()} - ${this.name}`;
    }

    async handle(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        await this.process(item, ruleResults);
        this.logger.debug(`${this.dryRun ? 'DRYRUN - ' : ''}Done`);
    }

    abstract process(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void>;
}

export interface ActionOptions extends ActionConfig {
    logger: Logger;
    subredditName: string;
}

export interface ActionConfig {
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
}

export interface ActionJson extends ActionConfig {
    /**
     * The type of action that will be performed
     */
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'flair' | 'usernote'
}

export const isActionJson = (obj: object): obj is ActionJson => {
    return (obj as ActionJson).kind !== undefined;
}

export default Action;

