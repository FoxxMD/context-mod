import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {activityIsRemoved} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, ActivityDispatchConfig, RuleResult} from "../Common/interfaces";
import dayjs from "dayjs";
import {activityDispatchConfigToDispatch, isSubmission, parseDurationValToDuration, randomId} from "../util";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTarget, ActionTypes} from "../Common/Infrastructure/Atomic";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";

export class DispatchAction extends Action {
    dispatchData: ActivityDispatchConfig;
    targets: ActionTarget[];

    getKind(): ActionTypes {
        return 'dispatch';
    }

    constructor(options: DispatchOptions) {
        super(options);
        const {
            cancelIfQueued = false,
            target = ['self'],
            goto,
            delay,
            identifier,
            onExistingFound,
            tardyTolerant,
        } = options;
        this.dispatchData = {
            goto,
            delay,
            identifier,
            onExistingFound,
            tardyTolerant,
            cancelIfQueued,
        }
        this.targets = !Array.isArray(target) ? [target] : target;
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], actionResults: ActionResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        // ignore runtimeDryrun here because "real run" isn't causing any reddit api calls to happen
        // -- basically if bot is in dryrun this should still run since we want the "full effect" of the bot
        // BUT if the action explicitly sets 'dryRun: true' then do not dispatch as they probably don't want to it actually going (intention?)
        const dryRun = this.dryRun;

        // For the dispatched activity we want to make sure that if dryrun is set then it inherits that
        // Example scenario:
        // * Bot is running LIVE
        // * User manually checks an activity using "dry run" button
        // * DispatchAction is run
        // * Pass dryrun state for this activity onto the dispatched activity so it does not become live
        //
        // BUT ALSO we want to defer to manager/activity handle dryrun value as much as possible so
        // if dryrun is false IE 1) current manager is not in dryrun 2) and user didn't specify dryrun manually 3) and action doesn't explicitly specify dryrun
        // then don't "say" dryrun was explicitly set as false since it wasn't...we only need to explicitly specify dryrun if its true
        //
        // TODO reduce dryrun initial values, this is a bit complicated
        // should default it to undefined everywhere so we can better identify when its explicitly set instead of assuming false === not set
        const dispatchedDryRun = this.getRuntimeAwareDryrun(options) === false ? undefined : true;

        const realTargets = isSubmission(item) ? ['self'] : this.targets;
        if (this.targets.includes('parent') && isSubmission(item)) {
            if (this.targets.includes('self')) {
                this.logger.warning(`Cannot use 'parent' as target because Activity is a Submission. Reverted to 'self'`);
            } else {
                return {
                    dryRun,
                    success: false,
                    result: `Cannot use 'parent' as target because Activity is a Submission.`,
                }
            }
        }

        const runtimeDelay = options.disableDispatchDelays === true ? '1 second' : this.dispatchData.delay;
        const dur = parseDurationValToDuration(runtimeDelay);

        const dispatchActivitiesHints = [];
        for (const target of realTargets) {
            let act = item;
            let actHint = `Comment's parent Submission (${(item as Comment).link_id})`;
            if (target !== 'self') {
                if (!dryRun) {
                    act = await this.resources.getActivity(this.client.getSubmission((item as Comment).link_id));
                } else {
                    // don't need to spend api call to get submission if we won't actually do anything with it
                    // @ts-ignore
                    act = await this.resources.client.getSubmission((item as Comment).link_id);
                }
            } else {
                actHint = `This Activity (${item.name})`;
            }

            const existing = this.resources.delayedItems.filter(x => {
                const matchedActivityId = x.activity.name === act.name;
                const matchDispatchIdentifier = this.dispatchData.identifier === undefined ? true : this.dispatchData.identifier === x.identifier;
                return matchedActivityId && matchDispatchIdentifier;
            });

            if (existing.length > 0) {
                let existingRes = `Dispatch activities (${existing.map((x, index) => `[${index + 1}] Queued At ${x.queuedAt.format('YYYY-MM-DD HH:mm:ssZ')} for ${x.delay.humanize()}`).join(' ')}}) already exist for ${actHint}`;
                if (this.dispatchData.onExistingFound === 'skip') {
                    existingRes += ` and existing behavior is SKIP so nothing queued`;
                    continue;
                } else if (this.dispatchData.onExistingFound === 'replace') {
                    existingRes += ` and existing behavior is REPLACE so replaced existing`;
                    const existingIds = existing.map(x => x.id);
                    for(const id of existingIds) {
                        await this.resources.removeDelayedActivity(id);
                    }
                } else {
                    existingRes += ` but existing behavior is IGNORE so adding new dispatch activity anyway`;
                }
                dispatchActivitiesHints.push(existingRes);
            } else {
                dispatchActivitiesHints.push(actHint);
            }

            if (!dryRun) {
                await this.resources.addDelayedActivity(activityDispatchConfigToDispatch({...this.dispatchData, delay: runtimeDelay}, act, 'dispatch', {action: this.getActionUniqueName(), dryRun: dispatchedDryRun}))
            }
        }
        let dispatchBehaviors = [];
        if (this.dispatchData.identifier !== undefined) {
            dispatchBehaviors.push(`Identifier: ${this.dispatchData.identifier}`);
        }
        if (this.dispatchData.goto !== undefined) {
            dispatchBehaviors.push(`Goto: ${this.dispatchData.goto}`);
        }
        let result = `Delay: ${dur.humanize()}${dispatchBehaviors.length > 0 ? ` | ${dispatchBehaviors.join(' | ')}` : ''} | Dispatch Results: ${dispatchActivitiesHints.join(' <<>> ')}`;

        this.logger.verbose(result);
        return {
            dryRun,
            success: true,
            result,
        }
    }

    protected getSpecificPremise(): object {
        return {
            dispatchData: this.dispatchData,
            targets: this.targets
        }
    }
}

export interface DispatchOptions extends Omit<DispatchActionConfig, 'authorIs' | 'itemIs'>, ActionOptions {
}

export interface DispatchActionConfig extends ActionConfig, ActivityDispatchConfig {
    target: ActionTarget | ActionTarget[]
}

/**
 * Remove the Activity
 * */
export interface DispatchActionJson extends DispatchActionConfig, ActionJson {
    kind: 'dispatch'

}
