import Snoowrap, {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {createLabelledLogger} from "../util";

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
            this.logger = logger;
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
    name?: string;
}

/** @see {isActionConfig} ts-auto-guard:type-guard */
export interface ActionJSONConfig extends ActionConfig {
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'flair'
}

export default Action;

