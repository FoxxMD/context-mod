import {SubmissionActionConfig} from "./index";
import Action, {ActionJSONConfig} from "../index";
import Snoowrap, {Comment, Submission} from "snoowrap";

export class FlairAction extends Action {
    text: string;
    css: string;
    name?: string = 'Flair';

    constructor(options: FlairActionOptions) {
        super(options);
        if (options.text === undefined && options.css === undefined) {
            throw new Error('Must define either text or css on FlairAction');
        }
        this.text = options.text || '';
        this.css = options.css || '';
    }

    async handle(item: Comment | Submission, client: Snoowrap): Promise<void> {
        if (item instanceof Submission) {
            // @ts-ignore
            await item.assignFlair({text: this.text, cssClass: this.css})
        }
    }
}

/**
 * @minProperties 1
 * @additionalProperties false
 * */
export interface FlairActionOptions extends SubmissionActionConfig {
    /**
     * The text of the flair to apply
    * */
    text?: string,
    /**
     * The text of the css class of the flair to apply
     * */
    css?: string,
}

/**
 * Flair the Submission
 * */
export interface FlairActionJSONConfig extends FlairActionOptions, ActionJSONConfig {

}
