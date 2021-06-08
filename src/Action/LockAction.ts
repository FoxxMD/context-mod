import {ActionJson, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";

export class LockAction extends Action {
    name?: string = 'Lock';
    async handle(item: Comment|Submission, ruleResults: RuleResult[]): Promise<void> {
        if (item instanceof Submission) {
            // @ts-ignore
            await item.lock();
        }
    }
}

export interface LockActionConfig extends ActionConfig {

}

/**
 * Lock the Activity
 * */
export interface LockActionJson extends LockActionConfig, ActionJson {

}

export default LockAction;
