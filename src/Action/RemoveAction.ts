import {ActionJSONConfig, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";

export class RemoveAction extends Action {
    name?: string = 'Remove';
    async handle(item: Comment|Submission, client: Snoowrap): Promise<void> {
    }
}

export interface RemoveActionConfig extends ActionConfig {

}

export interface RemoveActionJSONConfig extends RemoveActionConfig, ActionJSONConfig {

}
