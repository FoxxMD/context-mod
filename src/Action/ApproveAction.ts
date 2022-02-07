import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap from "snoowrap";
import {RuleResult} from "../Rule";
import {ActionProcessResult} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";

export class ApproveAction extends Action {

    targets: ApproveTarget[]

    getKind() {
        return 'Approve';
    }

    constructor(options: ApproveOptions) {
        super(options);
        const {
            targets = ['self']
        } = options;

        this.targets = targets;
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;
        const touchedEntities = [];

        const realTargets = item instanceof Submission ? ['self'] : this.targets;

        for(const target of realTargets) {
            let targetItem = item;
            if(target !== 'self' && item instanceof Comment) {
                targetItem = await this.resources.getActivity(this.client.getSubmission(item.link_id));
            }

            // @ts-ignore
            if (item.approved) {
                const msg = `${target === 'self' ? 'Item' : 'Comment\'s parent Submission'} is already approved`;
                this.logger.warn(msg);
                return {
                    dryRun,
                    success: false,
                    result: msg
                }
            }

            if (!dryRun) {
                // make sure we have an actual item and not just a plain object from cache
                if(target !== 'self' && !(targetItem instanceof Submission)) {
                    // @ts-ignore
                    targetItem = await this.client.getSubmission((item as Comment).link_id).fetch();
                }
                // @ts-ignore
                touchedEntities.push(await targetItem.approve());

                if(target === 'self') {
                    // @ts-ignore
                    item.approved = true;
                    if(await this.resources.hasActivity(item)) {
                        await this.resources.setActivity(item, false);
                    }
                } else if(await this.resources.hasActivity(targetItem)) {
                    // @ts-ignore
                    targetItem.approved = true;
                    await this.resources.setActivity(targetItem, false);
                }
            }
        }

        return {
            dryRun,
            success: true,
            touchedEntities
        }
    }
}

export type ApproveTarget = 'self' | 'parent';

export interface ApproveOptions extends ApproveActionConfig, ActionOptions {}

export interface ApproveActionConfig extends ActionConfig {
    /**
     * Specify which Activities to approve
     *
     * This setting is only applicable if the Activity being acted on is a **comment**. On a **submission** the setting does nothing
     *
     * * self => approve activity being checked (comment)
     * * parent => approve parent (submission) of activity being checked (comment)
     * */
    targets?: ApproveTarget[]
}

/**
 * Ban the Author of the Activity this Check is run on
 * */
export interface ApproveActionJson extends ApproveActionConfig, ActionJson {
    kind: 'approve'
}

export default ApproveAction;
