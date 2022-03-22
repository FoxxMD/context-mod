import {ActionJson, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {ActionProcessResult, RuleResult} from "../Common/interfaces";
import {ActionTypes} from "../Common/types";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";

export class LockAction extends Action {
    getKind(): ActionTypes {
        return 'lock';
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
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
