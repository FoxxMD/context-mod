import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap from "snoowrap";
import {ActionProcessResult, ActionTarget, RuleResult} from "../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {ActionTypes} from "../Common/types";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";

export class ContributorAction extends Action {

    actionType: ContributorActionType;

    getKind(): ActionTypes {
        return 'contributor';
    }

    constructor(options: ContributorOptions) {
        super(options);
        const {
            action
        } = options;

        this.actionType = action;
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;

        const contributors = await this.resources.getSubredditContributors();

        if(this.actionType === 'add') {
            if(contributors.some(x => x.name === item.author.name)) {
                return {
                    dryRun,
                    success: false,
                    result: 'Author is already a contributor, cannot add them'
                }
            }

            if(!dryRun) {
                // @ts-ignore
                await this.resources.subreddit.addContributor({name: item.author.name});
                await this.resources.addUserToSubredditContributorsCache(item.author);
            }
        } else {
            if(!contributors.some(x => x.name === item.author.name)) {
                return {
                    dryRun,
                    success: false,
                    result: 'Author is not a contributor, cannot remove them'
                }
            }

            if(!dryRun) {
                // @ts-ignore
                await this.resources.subreddit.removeContributor({name: item.author.name});
                await this.resources.removeUserFromSubredditContributorsCache(item.author);
            }
        }

        return {
            dryRun,
            success: true,
            result: this.actionType === 'add' ? 'Added Author to contributors' : 'Remove Author from contributors'
        };
    }

    protected getSpecificPremise(): object {
        return {
            actionType: this.actionType
        }
    }
}

export interface ContributorOptions extends Omit<ContributorActionConfig, 'authorIs' | 'itemIs'>, ActionOptions {}

export interface ContributorActionConfig extends ActionConfig {
    action: ContributorActionType
}

/**
 * Ban the Author of the Activity this Check is run on
 * */
export interface ContributorActionJson extends ContributorActionConfig, ActionJson {
    kind: 'contributor'
}

export default ContributorAction;

export type ContributorActionType = 'add' | 'remove';
