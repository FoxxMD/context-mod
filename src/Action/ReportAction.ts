import {ActionJSONConfig, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";

export class ReportAction extends Action {
    content: string;
    name?: string = 'Report';

    constructor(options: ReportActionOptions) {
        super(options);
        this.content = options.content;
    }

    async handle(item: Comment | Submission, client: Snoowrap): Promise<void> {
        // @ts-ignore
        await item.report({reason: content});
    }
}

export interface ReportActionConfig {
    /**
     * The text of the report
     * */
    content: string,
}

export interface ReportActionOptions extends ReportActionConfig, ActionOptions {
}

/**
 * Report the Activity
 * */
export interface ReportActionJSONConfig extends ReportActionConfig, ActionJSONConfig {

}
