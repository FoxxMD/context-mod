import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";
import {activityIsRemoved} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, ActionTarget, ActivityRerunConfig} from "../Common/interfaces";
import dayjs from "dayjs";
import {isSubmission, parseDurationValToDuration, randomId} from "../util";

export class RerunAction extends Action {
    rerunData: ActivityRerunConfig;
    targets: ActionTarget[];

    getKind() {
        return 'Rerun';
    }

    constructor(options: RerunOptions) {
        super(options);
        const {
            rerunIdentifier,
            cancelIfQueued = false,
            goto,
            delay,
            target = ['self']
        } = options;
        this.rerunData = {
            rerunIdentifier,
            cancelIfQueued,
            goto,
            delay,
        }
        this.targets = !Array.isArray(target) ? [target] : target;
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
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

        const {delay, ...restRerunData} = this.rerunData;
        const rerunPayload = {
            ...restRerunData,
            delay,
            queuedAt: dayjs().unix(),
            duration: parseDurationValToDuration(delay),
            processing: false,
        };

        const rerunActivitiesHints = [];
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
                actHint = 'Comment';
            }

            const existing = this.resources.delayedItems.filter(x => {
                const matchedActivityId = x.activity.name === act.name;
                const matchRerunIdentifier = rerunPayload.rerunIdentifier === undefined ? true : rerunPayload.rerunIdentifier === x.rerunIdentifier;
                return matchedActivityId && matchRerunIdentifier;
            });

            if (existing.length > 0) {
                let existingRes = `Rerun activities (${existing.map((x, index) => `[${index + 1}] Queued At ${dayjs.unix(x.queuedAt).format('YYYY-MM-DD HH:mm:ssZ')} for ${x.duration.humanize()}`).join(' ')}}) already exist for ${actHint}`;
                if (this.rerunData.onExistingFound === 'skip') {
                    existingRes += ` and existing behavior is SKIP so nothing queued`;
                    continue;
                } else if (this.rerunData.onExistingFound === 'replace') {
                    existingRes += ` and existing behavior is REPLACE so replaced existing`;
                    const existingIds = existing.map(x => x.id);
                    this.resources.delayedItems = this.resources.delayedItems.filter(x => !existingIds.includes(x.id));
                } else {
                    existingRes += ` but existing behavior is IGNORE so adding new rerun activity anyway`;
                }
                rerunActivitiesHints.push(existingRes);
            } else {
                rerunActivitiesHints.push(actHint);
            }

            if (!dryRun) {
                this.resources.delayedItems.push({
                    ...rerunPayload,
                    activity: act,
                    id: randomId(),
                    action: this.getActionUniqueName()
                });
            }
        }
        let rerunBehaviors = [];
        if (rerunPayload.rerunIdentifier !== undefined) {
            rerunBehaviors.push(`Identifier: ${rerunPayload.rerunIdentifier}`);
        }
        if (rerunPayload.goto !== undefined) {
            rerunBehaviors.push(`Goto: ${rerunPayload.goto}`);
        }
        let result = `Delay: ${rerunPayload.duration.humanize()}${rerunBehaviors.length > 0 ? `| ${rerunBehaviors.join(' | ')}` : ''} | Queue Results:\n${rerunActivitiesHints.join('\n')}`;

        this.logger.verbose(result);
        return {
            dryRun,
            success: true,
            result,
        }
    }
}

export interface RerunOptions extends RerunActionConfig, ActionOptions {
}

export interface RerunActionConfig extends ActionConfig, ActivityRerunConfig {
    target: ActionTarget | ActionTarget[]
}

/**
 * Remove the Activity
 * */
export interface RerunActionJson extends RerunActionConfig, ActionJson {
    kind: 'rerun'

}
