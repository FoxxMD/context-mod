import {ActionJson, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";
import {ActionProcessResult} from "../Common/interfaces";

export class ApproveAction extends Action {
    getKind() {
        return 'Approve';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;
        const touchedEntities = [];
        //snoowrap typing issue, thinks comments can't be locked
        // @ts-ignore
        if (item.approved) {
            this.logger.warn('Item is already approved');
            return {
                dryRun,
                success: false,
                result: 'Item is already approved'
            }
        }
        if (!dryRun) {
            // @ts-ignore
            touchedEntities.push(await item.approve());
        }
        return {
            dryRun,
            success: true,
            touchedEntities
        }
    }
}

export interface ApproveActionConfig extends ActionConfig {

}

/**
 * Ban the Author of the Activity this Check is run on
 * */
export interface ApproveActionJson extends ApproveActionConfig, ActionJson {
    kind: 'approve'
}

export default ApproveAction;
