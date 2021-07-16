import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {truncateStringToLength} from "../util";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RuleResult} from "../Rule";
import {RichContent} from "../Common/interfaces";

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

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<void> {
        const dryRun = runtimeDryrun || this.dryRun;
        const content = await this.resources.getContent(this.content, item.subreddit);
        const renderedContent = await renderContent(content, item, ruleResults, this.resources.userNotes);
        this.logger.verbose(`Contents:\r\n${renderedContent}`);
        const truncatedContent = reportTrunc(renderedContent);
        if(!dryRun) {
            // @ts-ignore
            await item.report({reason: truncatedContent});
        }
    }
}

export interface ReportActionConfig extends RichContent {
}

export interface ReportActionOptions extends ReportActionConfig, ActionOptions {
}

/**
 * Report the Activity
 * */
export interface ReportActionJson extends ReportActionConfig, ActionJson {
    kind: 'report'
}
