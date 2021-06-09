import {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {RuleResult} from "../Rule";

export abstract class Action {
    name?: string;
    logger: Logger;

    constructor(options: ActionOptions) {
        const {
            name = this.getKind(),
            logger,
        } = options;

        this.name = name;
        const uniqueName = this.name === this.getKind() ? this.getKind() : `${this.getKind()} - ${this.name}`;
        this.logger = logger.child({labels: ['Action', uniqueName]});
    }

    abstract getKind(): string;

    async handle(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        await this.process(item, ruleResults);
        this.logger.debug('Done');
    }

    abstract process(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void>;
}

export interface ActionOptions {
    name?: string;
    logger: Logger,
}

export interface ActionConfig {
    /**
     * An optional, but highly recommended, friendly name for this Action. If not present will default to `kind`.
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * */
    name?: string;
}

export interface ActionJson extends ActionConfig {
    /**
     * The type of action that will be performed
     */
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'flair'
}

export const isActionJson = (obj: object): obj is ActionJson => {
    return (obj as ActionJson).kind !== undefined;
}

export default Action;

