import {SubmissionActionConfig} from "./index";
import Action, {ActionJson, ActionOptions} from "../index";
import {ActionProcessResult, RuleResult} from "../../Common/interfaces";
import Submission from 'snoowrap/dist/objects/Submission';
import Comment from 'snoowrap/dist/objects/Comment';
import {RuleResultEntity} from "../../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../../Subreddit/Manager";
import {ActionTypes} from "../../Common/Infrastructure/Atomic";
import {ActionResultEntity} from "../../Common/Entities/ActionResultEntity";

export class FlairAction extends Action {
    text: string;
    css: string;
    flair_template_id: string;

    constructor(options: FlairActionOptions) {
        super(options);
        if (options.text === undefined && options.css === undefined && options.flair_template_id === undefined) {
            throw new Error('Must define either text+css or flair_template_id on FlairAction');
        }
        this.text = options.text || '';
        this.css = options.css || '';
        this.flair_template_id = options.flair_template_id || '';
    }

    getKind(): ActionTypes {
        return 'flair';
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], actionResults: ActionResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
        let flairParts = [];
        const renderedText = this.text === '' ? '' : await this.renderContent(this.text, item, ruleResults, actionResults) as string;
        flairParts.push(`Text: ${renderedText === '' ? '(None)' : renderedText}`);

        const renderedCss = this.css === '' ? '' : await this.renderContent(this.css, item, ruleResults, actionResults) as string;
        flairParts.push(`CSS: ${renderedCss === '' ? '(None)' : renderedCss}`);

        flairParts.push(`Template: ${this.flair_template_id === '' ? '(None)' : this.flair_template_id}`);

        const flairSummary = flairParts.length === 0 ? 'No flair (unflaired)' : flairParts.join(' | ');
        this.logger.verbose(flairSummary);
        if (item instanceof Submission) {
            if(!this.dryRun) {
                if (this.flair_template_id) {
                    await item.selectFlair({flair_template_id: this.flair_template_id}).then(() => {});
                    item.link_flair_template_id = this.flair_template_id;
                } else {
                    await item.assignFlair({text: renderedText, cssClass: renderedCss}).then(() => {});
                    item.link_flair_css_class = renderedCss;
                    item.link_flair_text = renderedText;
                }
                await this.resources.resetCacheForItem(item);
            }
        } else {
            this.logger.warn('Cannot flair Comment');
            return {
                dryRun,
                success: false,
                result: 'Cannot flair Comment',
            }
        }
        return {
            dryRun,
            success: true,
            result: flairSummary
        }
    }

    protected getSpecificPremise(): object {
        return {
            text: this.text,
            css: this.css,
            flair_template_id: this.flair_template_id
        }
    }
}

/**
 * @minProperties 1
 * @additionalProperties false
 * */
export interface FlairActionConfig extends SubmissionActionConfig {
    /**
     * The text of the flair to apply
     * */
    text?: string,
    /**
     * The text of the css class of the flair to apply
     * */
    css?: string,
    /**
     * Flair template ID to assign
     * */
    flair_template_id?: string,
}

export interface FlairActionOptions extends Omit<FlairActionConfig, 'authorIs' | 'itemIs'>,ActionOptions {

}

/**
 * Flair the Submission
 * */
export interface FlairActionJson extends FlairActionConfig, ActionJson {
    kind: 'flair'
}
