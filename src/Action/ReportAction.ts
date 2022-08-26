import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {truncateStringToLength} from "../util";
import {renderContent} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, RichContent, RuleResult} from "../Common/interfaces";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTypes} from "../Common/Infrastructure/Atomic";

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

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
        const renderedContent = (await this.renderContent(this.content, item, ruleResults) as string);
        this.logger.verbose(`Contents:\r\n${renderedContent}`);
        const truncatedContent = reportTrunc(renderedContent);
        const touchedEntities = [];
        if(!dryRun) {
            // @ts-ignore
            await item.report({reason: truncatedContent});
            // due to reddit not updating this in response (maybe)?? just increment stale activity
            item.num_reports++;
            await this.resources.resetCacheForItem(item);
            // add to recent so we ignore activity when/if it is discovered by polling
            await this.resources.setRecentSelf(item);
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
