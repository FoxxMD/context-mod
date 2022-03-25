import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {activityIsRemoved} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, ActionTarget, ActivityDispatchConfig, RuleResult} from "../Common/interfaces";
import dayjs from "dayjs";
import {activityDispatchConfigToDispatch, isSubmission, parseDurationValToDuration, randomId} from "../util";
import {ActionTypes} from "../Common/types";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";

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

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;

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

        const dur = parseDurationValToDuration(this.dispatchData.delay);

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
                let existingRes = `Dispatch activities (${existing.map((x, index) => `[${index + 1}] Queued At ${dayjs.unix(x.queuedAt).format('YYYY-MM-DD HH:mm:ssZ')} for ${dayjs.duration(x.delay, 'millisecond').humanize()}`).join(' ')}}) already exist for ${actHint}`;
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
                await this.resources.addDelayedActivity(activityDispatchConfigToDispatch(this.dispatchData, act, 'dispatch', this.getActionUniqueName()))
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

export interface DispatchOptions extends DispatchActionConfig, ActionOptions {
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
