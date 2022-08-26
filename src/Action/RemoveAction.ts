import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {activityIsRemoved} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, RuleResult} from "../Common/interfaces";
import dayjs from "dayjs";
import {isSubmission, truncateStringToLength} from "../util";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTypes} from "../Common/Infrastructure/Atomic";

const truncate = truncateStringToLength(100);
export class RemoveAction extends Action {
    spam: boolean;
    note?: string;
    reasonId?: string;

    getKind(): ActionTypes {
        return 'remove';
    }

    constructor(options: RemoveOptions) {
        super(options);
        const {
            spam = false,
            note,
            reasonId,
        } = options;
        this.spam = spam;
        this.note = note;
        this.reasonId = reasonId;
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
        const touchedEntities = [];
        let removeSummary = [];
        // issue with snoowrap typings, doesn't think prop exists on Submission
        // @ts-ignore
        if (activityIsRemoved(item)) {
            this.logger.warn('It looks like this Item is already removed!');
        }
        if (this.spam) {
            removeSummary.push('Marked as SPAM');
            this.logger.verbose('Marking as spam on removal');
        }
        const renderedNote = await this.renderContent(this.note, item, ruleResults);
        let foundReasonId: string | undefined;
        let foundReason: string | undefined;

        if(this.reasonId !== undefined) {
            const reason = await this.resources.getSubredditRemovalReasonById(this.reasonId);
            if(reason === undefined) {
                const reasonWarn = [`Could not find any Removal Reason with the ID ${this.reasonId}!`];
                if(renderedNote === undefined) {
                    reasonWarn.push('Cannot add any Removal Reason because note is also empty!');
                } else {
                    reasonWarn.push('Will add Removal Reason but only with note.');
                }
                this.logger.warn(reasonWarn.join(''));
            } else {
                foundReason = truncate(reason.title);
                foundReasonId = reason.id;
                removeSummary.push(`Reason: ${truncate(foundReason)} (${foundReasonId})`);
            }
        }

        if(renderedNote !== undefined) {
            removeSummary.push(`Note: ${truncate(renderedNote)}`);
        }

        this.logger.verbose(removeSummary.join(' | '));

        if (!dryRun) {
            // @ts-ignore
            await item.remove({spam: this.spam});
            item.banned_at_utc = dayjs().unix();
            item.spam = this.spam;
            if(!isSubmission(item)) {
                // @ts-ignore
                item.removed = true;
            }

            if(foundReasonId !== undefined || renderedNote !== undefined) {
                await this.client.addRemovalReason(item, renderedNote, foundReasonId);
                item.mod_reason_by = this.resources.botAccount as string;
                if(renderedNote !== undefined) {
                    item.removal_reason = renderedNote;
                }
                if(foundReason !== undefined) {
                    item.mod_reason_title = foundReason;
                }
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
    /** (Optional) Mark Activity as spam */
    spam?: boolean
    /**  (Optional) A mod-readable note added to the removal reason for this Activity. Can use Templating.
     *
     * This note (and removal reasons) are only visible on New Reddit
     * */
    note?: string
    /** (Optional) The ID of the Removal Reason to use
     *
     * Removal reasons are only visible on New Reddit
     *
     * To find IDs for removal reasons check the "Removal Reasons" popup located in the CM dashboard config editor for your subreddit
     *
     * More info on Removal Reasons: https://mods.reddithelp.com/hc/en-us/articles/360010094892-Removal-Reasons
     * */
    reasonId?: string
}

/**
 * Remove the Activity
 * */
export interface RemoveActionJson extends RemoveActionConfig, ActionJson {
    kind: 'remove'
}
