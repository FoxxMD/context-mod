import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {activityIsRemoved} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, RuleResult} from "../Common/interfaces";
import dayjs from "dayjs";
import {isSubmission} from "../util";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTypes} from "../Common/Infrastructure/Atomic";

export class RemoveAction extends Action {
    spam: boolean;

    getKind(): ActionTypes {
        return 'remove';
    }

    constructor(options: RemoveOptions) {
        super(options);
        const {
            spam = false,
        } = options;
        this.spam = spam;
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
        const touchedEntities = [];
        // issue with snoowrap typings, doesn't think prop exists on Submission
        // @ts-ignore
        if (activityIsRemoved(item)) {
            this.logger.warn('It looks like this Item is already removed!');
        }
        if (this.spam) {
            this.logger.verbose('Marking as spam on removal');
        }
        if (!dryRun) {
            // @ts-ignore
            await item.remove({spam: this.spam});
            item.banned_at_utc = dayjs().unix();
            item.spam = this.spam;
            if(!isSubmission(item)) {
                // @ts-ignore
                item.removed = true;
            }
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
        return {
            spam: this.spam
        }
    }
}

export interface RemoveOptions extends Omit<RemoveActionConfig, 'authorIs' | 'itemIs'>, ActionOptions {
}

export interface RemoveActionConfig extends ActionConfig {
    spam?: boolean
}

/**
 * Remove the Activity
 * */
export interface RemoveActionJson extends RemoveActionConfig, ActionJson {
    kind: 'remove'
}
