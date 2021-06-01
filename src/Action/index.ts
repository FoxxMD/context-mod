import Snoowrap, {Comment, Submission} from "snoowrap";

export abstract class Action {
    name?: string;

    constructor(options: ActionConfig = {}) {
        const {
            name
        } = options;
        if (name !== undefined) {
            this.name = name;
        }
    }

    abstract handle(item: Comment | Submission, client: Snoowrap): Promise<void>;
}

export interface ActionConfig {
    name?: string;
}

/** @see {isActionConfig} ts-auto-guard:type-guard */
export interface ActionJSONConfig extends ActionConfig {
    kind: 'comment' | 'lock' | 'remove' | 'report' | 'flair'
}

export default Action;

