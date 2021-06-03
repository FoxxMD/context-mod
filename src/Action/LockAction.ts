import {ActionJSONConfig, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";

export class LockAction extends Action {
    name?: string = 'Lock';
    async handle(item: Comment|Submission, client: Snoowrap): Promise<void> {
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
export interface LockActionJSONConfig extends LockActionConfig, ActionJSONConfig {

}

export default LockAction;
