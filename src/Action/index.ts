import Snoowrap, {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {createLabelledLogger, loggerMetaShuffle} from "../util";

export abstract class Action {
    name?: string;
    logger: Logger;

    constructor(options: ActionOptions = {}) {
        const {
            name,
            loggerPrefix = '',
            logger,
        } = options;
        if (name !== undefined) {
            this.name = name;
        }
        if (logger === undefined) {
            const prefix = `${loggerPrefix}|${this.name}`;
            this.logger = createLabelledLogger(prefix, prefix);
        } else {
            this.logger = logger.child(loggerMetaShuffle(logger, name || 'Action', undefined, {truncateLength: 100}));
        }
    }

    abstract handle(item: Comment | Submission, client: Snoowrap): Promise<void>;
}

export interface ActionOptions {
    name?: string;
    logger?: Logger,
    loggerPrefix?: string,
}

export interface ActionConfig {
    /**
     * A friendly name for this Action
     * */
    name?: string;
}

/** @see {isActionConfig} ts-auto-guard:type-guard */
export interface ActionJSONConfig extends ActionConfig {
    /**
     * The type of action that will be performed
     */
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'flair'
}

export default Action;

