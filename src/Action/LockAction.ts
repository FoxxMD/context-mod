import {ActionJson, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";
import {ActionProcessResult} from "../Common/interfaces";

export class LockAction extends Action {
    getKind() {
        return 'Lock';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;
        const touchedEntities = [];
        //snoowrap typing issue, thinks comments can't be locked
        // @ts-ignore
        if (item.locked) {
            this.logger.warn('Item is already locked');
            return {
                dryRun,
                success: false,
                result: 'Item is already locked'
            };
        }
        if (!dryRun) {
            //snoowrap typing issue, thinks comments can't be locked
            // @ts-ignore
            await item.lock();
            // @ts-ignore
            item.locked = true;
            await this.resources.resetCacheForItem(item);
            touchedEntities.push(item);
        }
        return {
            dryRun,
            success: true,
            touchedEntities
        }
    }

    protected getSpecificPremise(): object {
        return {};
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
