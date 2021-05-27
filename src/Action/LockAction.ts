import {ActionJSONConfig, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";

export class LockAction extends Action {
    async handle(item: Comment|Submission, client: Snoowrap): Promise<void> {
    }
}

export interface LockActionConfig extends ActionConfig {

}

export interface LockActionJSONConfig extends LockActionConfig, ActionJSONConfig {

}

export default LockAction;
