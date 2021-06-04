import {ActionJSONConfig, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {truncateStringToLength} from "../util";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RuleResult} from "../Rule";

// https://www.reddit.com/dev/api/oauth#POST_api_report
// denotes 100 characters maximum
const reportTrunc = truncateStringToLength(100);

export class ReportAction extends Action {
    content: string;
    name?: string = 'Report';

    constructor(options: ReportActionOptions) {
        super(options);
        this.content = options.content || '';
    }

    async handle(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        const renderedContent = await renderContent(this.content, item, ruleResults);
        const truncatedContent = reportTrunc(renderedContent);
        // @ts-ignore
        await item.report({reason: truncatedContent});
    }
}

export interface ReportActionConfig {
    /**
     * The text of the report. If longer than 100 characters will be truncated to "[content]..."
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
