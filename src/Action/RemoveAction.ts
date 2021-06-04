import {ActionJSONConfig, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";

export class RemoveAction extends Action {
    name?: string = 'Remove';
    async handle(item: Comment|Submission, ruleResults: RuleResult[]): Promise<void> {
        // @ts-ignore
        await item.remove();
    }
}

export interface RemoveActionConfig extends ActionConfig {

}

/**
 * Remove the Activity
 * */
export interface RemoveActionJSONConfig extends RemoveActionConfig, ActionJSONConfig {

}
