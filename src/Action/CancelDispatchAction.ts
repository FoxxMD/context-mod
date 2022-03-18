import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";
import {activityIsRemoved} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, ActionTarget, ActivityDispatchConfig, InclusiveActionTarget} from "../Common/interfaces";
import dayjs from "dayjs";
import {isSubmission, parseDurationValToDuration} from "../util";

export class CancelDispatchAction extends Action {
    identifiers?: (string | null)[];
    targets: InclusiveActionTarget[];

    getKind() {
        return 'Cancel Dispatch';
    }

    constructor(options: CancelDispatchOptions) {
        super(options);
        const {
            identifier,
            target
        } = options;
        if (identifier === undefined) {
            this.identifiers = identifier;
        } else {
            this.identifiers = !Array.isArray(identifier) ? [identifier] : identifier;
        }
        this.targets = !Array.isArray(target) ? [target] : target;
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;

        const realTargets = isSubmission(item) ? this.targets.filter(x => x !== 'parent') : this.targets;
        if (this.targets.includes('parent') && isSubmission(item)) {
            if (realTargets.length > 0) {
                this.logger.warning(`Cannot use 'parent' as target because Activity is a Submission. Using other targets instead (${realTargets.join(',')})`);
            } else {
                return {
                    dryRun,
                    success: false,
                    result: `Cannot use 'parent' as target because Activity is a Submission and no other targets specified.`,
                }
            }
        }

        let cancelledActivities: string[] = [];
        for (const target of realTargets) {
            let matchId: string | undefined = item.name;
            if (target === 'parent') {
                matchId = (item as Comment).link_id;
            } else if (target === 'any') {
                matchId = undefined;
            }

            const delayedItemsToRemove = this.resources.delayedItems.filter(x => {
                const matchedId = matchId === undefined || x.activity.name === matchId;
                let matchedDispatchIdentifier;
                if (this.identifiers === undefined) {
                    matchedDispatchIdentifier = true;
                } else if (x.identifier === undefined) {
                    matchedDispatchIdentifier = this.identifiers.includes(null);
                } else {
                    matchedDispatchIdentifier = this.identifiers.filter(x => x !== null).includes(x.identifier);
                }
                const matched = matchedId && matchedDispatchIdentifier;
                if(matched && x.processing) {
                    this.logger.debug(`Cannot remove ${isSubmission(x.activity) ? 'Submission' : 'Comment'} ${x.activity.name} because it is currently processing`);
                    return false;
                }
                return matched;
            });
            let cancelCrit;
            if (this.identifiers === undefined) {
                cancelCrit = 'Any';
            } else {
                const idenfitierHints = [];
                if (this.identifiers.includes(null)) {
                    idenfitierHints.push('No Identifier');
                }
                const concreteIdentifiers = this.identifiers.filter(x => x !== null);
                if (concreteIdentifiers.length > 0) {
                    idenfitierHints.push(concreteIdentifiers.join(', '));
                }
                cancelCrit = idenfitierHints.join(' OR ');
            }

            let activityHint;
            if (target === 'self') {
                activityHint = 'This Activity';
            } else if (target === 'parent') {
                activityHint = `This Comment's parent Submission`;
            } else {
                activityHint = 'Any';
            }

            let cancelActivitiesHint;
            if (delayedItemsToRemove.length === 0) {
                cancelActivitiesHint = 'None Found';
            } else {
                const cancelActivitiesHintArr = delayedItemsToRemove.map(x => `${isSubmission(x.activity) ? 'Submission' : 'Comment'} ${x.activity.name}`);
                cancelledActivities = cancelledActivities.concat(cancelActivitiesHintArr);
                cancelActivitiesHint = cancelActivitiesHintArr.join(', ');
            }
            const cancelResult = `Identifiers: ${cancelCrit} | Target: ${activityHint} | Results: ${cancelActivitiesHint}`;
            this.logger.verbose(cancelResult);
            if (!dryRun) {
                const activityIds = delayedItemsToRemove.map(x => x.id);
                this.resources.delayedItems = this.resources.delayedItems.filter(x => !activityIds.includes(x.id));
            }
        }

        return {
            dryRun,
            success: true,
            result: cancelledActivities.length === 0 ? 'No Dispatch Actions cancelled' : `Cancelled Dispatch Actions: ${cancelledActivities.join(', ')}`,
        }
    }
}

export interface CancelDispatchOptions extends CancelDispatchActionConfig, ActionOptions {
}

export interface CancelDispatchActionConfig extends ActionConfig {
    target: InclusiveActionTarget | InclusiveActionTarget[]
    identifier?: string | string[] | null
}

/**
 * Remove the Activity
 * */
export interface CancelDispatchActionJson extends CancelDispatchActionConfig, ActionJson {
    kind: 'cancelDispatch'
}
