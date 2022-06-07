import {ActionJson, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {ActionProcessResult, RuleResult} from "../Common/interfaces";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTypes} from "../Common/Infrastructure/Atomic";

export class LockAction extends Action {
    getKind(): ActionTypes {
        return 'lock';
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
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
