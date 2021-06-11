import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {truncateStringToLength} from "../util";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RuleResult} from "../Rule";

// https://www.reddit.com/dev/api/oauth#POST_api_report
// denotes 100 characters maximum
const reportTrunc = truncateStringToLength(100);
// actually only applies to VISIBLE text on OLD reddit... on old reddit rest of text is visible on hover. on new reddit the whole thing displays (up to at least 400 characters)

export class ReportAction extends Action {
    content: string;

    constructor(options: ReportActionOptions) {
        super(options);
        this.content = options.content || '';
    }

    getKind() {
        return 'Report';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        const content = await this.cache.getContent(this.content, item.subreddit);
        const renderedContent = await renderContent(content, item, ruleResults);
        this.logger.verbose(`Contents:\r\n${renderedContent}`);
        const truncatedContent = reportTrunc(renderedContent);
        if(!this.dryRun) {
            // @ts-ignore
            await item.report({reason: truncatedContent});
        }
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
export interface ReportActionJson extends ReportActionConfig, ActionJson {

}
