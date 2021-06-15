import {SubmissionActionConfig} from "./index";
import Action, {ActionJson, ActionOptions} from "../index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../../Rule";

export class FlairAction extends Action {
    text: string;
    css: string;

    constructor(options: FlairActionOptions) {
        super(options);
        if (options.text === undefined && options.css === undefined) {
            throw new Error('Must define either text or css on FlairAction');
        }
        this.text = options.text || '';
        this.css = options.css || '';
    }

    getKind() {
        return 'Flair';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        if (item instanceof Submission) {
            if(!this.dryRun) {
                // @ts-ignore
                await item.assignFlair({text: this.text, cssClass: this.css})
            }
        } else {
            this.logger.warn('Cannot flair Comment');
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
}

export interface FlairActionOptions extends FlairActionConfig,ActionOptions {

}

/**
 * Flair the Submission
 * */
export interface FlairActionJson extends FlairActionConfig, ActionJson {
kind: 'flair'
}
