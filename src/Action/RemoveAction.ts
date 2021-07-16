import {ActionJson, ActionConfig} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";
import {activityIsRemoved} from "../Utils/SnoowrapUtils";

export class RemoveAction extends Action {
    getKind() {
        return 'Remove';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<void> {
        const dryRun = runtimeDryrun || this.dryRun;
        // issue with snoowrap typings, doesn't think prop exists on Submission
        // @ts-ignore
        if (activityIsRemoved(item)) {
            this.logger.warn('Item is already removed');
            return;
        }
        if (!dryRun) {
            // @ts-ignore
            await item.remove();
        }
    }
}

export interface RemoveActionConfig extends ActionConfig {

}

/**
 * Remove the Activity
 * */
export interface RemoveActionJson extends RemoveActionConfig, ActionJson {
kind: 'remove'
}
