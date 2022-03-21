import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {truncateStringToLength} from "../util";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RuleResult} from "../Rule";
import {ActionProcessResult, RichContent} from "../Common/interfaces";
import {ActionTypes} from "../Common/types";

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

    getKind(): ActionTypes {
        return 'report';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;
        const content = await this.resources.getContent(this.content, item.subreddit);
        const renderedContent = await renderContent(content, item, ruleResults, this.resources.userNotes);
        this.logger.verbose(`Contents:\r\n${renderedContent}`);
        const truncatedContent = reportTrunc(renderedContent);
        const touchedEntities = [];
        if(!dryRun) {
            // @ts-ignore
            await item.report({reason: truncatedContent});
            // due to reddit not updating this in response (maybe)?? just increment stale activity
            item.num_reports++;
            await this.resources.resetCacheForItem(item);
            touchedEntities.push(item);
        }

        return {
            dryRun,
            success: true,
            result: truncatedContent,
            touchedEntities
        };
    }

    protected getSpecificPremise(): object {
        return {
            content: this.content
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
