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

export interface FlairActionOptions extends SubmissionActionConfig {
    text?: string,
    css?: string,
}

export interface FlairActionJSONConfig extends FlairActionOptions, ActionJSONConfig {

}
