import {ActionJSONConfig, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";

export class ReportAction extends Action {
    content: string;

    constructor(options: ReportActionOptions) {
        super();
        this.content = options.content;
    }

    async handle(item: Comment|Submission, client: Snoowrap): Promise<void> {
    }
}

export interface ReportActionOptions extends ActionConfig {
    content: string,
}

export interface ReportActionJSONConfig extends ReportActionOptions, ActionJSONConfig {

}
