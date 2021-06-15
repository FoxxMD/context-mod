import {ActionJson, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";

export class LockAction extends Action {
    getKind() {
        return 'Lock';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        //snoowrap typing issue, thinks comments can't be locked
        // @ts-ignore
        if (item.locked) {
            this.logger.warn('Item is already locked');
        }
        if (!this.dryRun) {
            //snoowrap typing issue, thinks comments can't be locked
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
kind: 'lock'
}

export default LockAction;
