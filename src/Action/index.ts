import {Comment, Submission} from "snoowrap";
import {Logger} from "winston";
import {checkAuthorFilter, checkItemFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {
    ActionProcessResult,
    ActionResult, ObjectPremise, RuleResult
} from "../Common/interfaces";
import {mergeArr, normalizeCriteria} from "../util";
import LoggedError from "../Utils/LoggedError";
import {ExtendedSnoowrap} from '../Utils/SnoowrapClients';
import {ErrorWithCause} from "pony-cause";
import EventEmitter from "events";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionPremise} from "../Common/Entities/ActionPremise";
import objectHash from "object-hash";
import {RuleType} from "../Common/Entities/RuleType";
import {ActionType} from "../Common/Entities/ActionType";
import { capitalize } from "lodash";
import { RuleResultEntity } from "../Common/Entities/RuleResultEntity";
import { RunnableBase } from "../Common/RunnableBase";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";
import {FindOptionsWhere} from "typeorm/find-options/FindOptionsWhere";
import {RulePremise} from "../Common/Entities/RulePremise";
import {AuthorCriteria, TypedActivityState, TypedActivityStates} from "../Common/Infrastructure/Filters/FilterCriteria";
import {ActionTypes} from "../Common/Infrastructure/Atomic";
import {RunnableBaseJson, RunnableBaseOptions, StructuredRunnableBase} from "../Common/Infrastructure/Runnable";
import {AuthorOptions, ChecksActivityState, FilterResult} from "../Common/Infrastructure/Filters/FilterShapes";

export abstract class Action extends RunnableBase {
    name?: string;
    logger: Logger;
    client: ExtendedSnoowrap;
    dryRun: boolean;
    enabled: boolean;
    managerEmitter: EventEmitter;
    // actionEntity: ActionEntity | null = null;
    actionPremiseEntity: ActionPremise | null = null;

    constructor(options: ActionOptions) {
        super(options);
        const {
            enable = true,
            name = this.getKind(),
            client,
            logger,
            subredditName,
            dryRun = false,
            emitter,
        } = options;

        this.name = name;
        this.dryRun = dryRun;
        this.enabled = enable;
        this.client = client;
        this.logger = logger.child({labels: [`Action ${this.getActionUniqueName()}`]}, mergeArr);
        this.managerEmitter = emitter;
    }

    abstract getKind(): ActionTypes;

    getActionUniqueName() {
        return this.name === this.getKind() ? capitalize(this.getKind()) : `${capitalize(this.getKind())} - ${this.name}`;
    }

    protected abstract getSpecificPremise(): object;

    getPremise(): ObjectPremise {
        const config = this.getSpecificPremise();
        return {
            kind: this.getKind(),
            config: config,
            authorIs: this.authorIs,
            itemIs: this.itemIs,
        };
    }

    async initialize() {
        if (this.actionPremiseEntity === null) {
            const prem = this.getPremise();
            const kind = await this.resources.database.getRepository(ActionType).findOne({where: {name: this.getKind()}});

            const candidatePremise = new ActionPremise({
                name: this.name,
                kind: kind as ActionType,
                config: prem,
                manager: this.resources.managerEntity,
            })

            const actionPremiseRepo = this.resources.database.getRepository(ActionPremise);

            const searchCriteria: FindOptionsWhere<ActionPremise> = {
                kind: {
                    id: kind?.id
                },
                configHash: candidatePremise.configHash,
                manager: {
                    id: this.resources.managerEntity.id
                },
                itemIsConfigHash: candidatePremise.itemIsConfigHash,
                authorIsConfigHash: candidatePremise.authorIsConfigHash,
                name: this.name
            };

            if(this.name !== undefined) {
                searchCriteria.name = this.name;
            }

            try {
                this.actionPremiseEntity = await actionPremiseRepo.findOne({
                    where: searchCriteria
                });
                if (this.actionPremiseEntity === null) {
                    this.actionPremiseEntity = await actionPremiseRepo.save(candidatePremise);
                }
            } catch (err) {
                const f = err;
            }
        }
    }

    async handle(item: Comment | Submission, ruleResults: RuleResultEntity[], options: runCheckOptions): Promise<ActionResultEntity> {
        const {dryRun: runtimeDryrun} = options;
        const dryRun = runtimeDryrun || this.dryRun;

        const actRes = new ActionResultEntity({
            run: false,
            premise: this.actionPremiseEntity as ActionPremise,
            success: false,
            dryRun,
        });

        if(!this.enabled) {
            this.logger.info(`Not run because it is not enabled.`);
            actRes.runReason = 'Not enabled'
            return actRes;
        }

        try {
            const filterResults = await this.runFilters(item, options);
            const [itemRes, authorRes] = filterResults;
            actRes.itemIs = itemRes;
            actRes.authorIs = authorRes;

            const filtersPassed = filterResults.every(x => x === undefined || x.passed);
            let runReason = undefined;

            actRes.run = filtersPassed;
            if(!filtersPassed) {
                if(itemRes !== undefined && !itemRes.passed) {
                    runReason = `Activity did not pass 'itemIs' test, Action not run`;
                } else {
                    runReason = `Activity did not pass 'authorIs' test, Action not run`;
                }
                actRes.runReason = runReason;
                return actRes;
            }
            const results = await this.process(item, ruleResults, options);
            actRes.success = results.success;
            actRes.dryRun = results.dryRun;
            actRes.result = results.result;
            actRes.touchedEntities = results.touchedEntities ?? [];

            return actRes;
        } catch (err: any) {
            if(!(err instanceof LoggedError)) {
                const actionError = new ErrorWithCause('Action did not run successfully due to unexpected error', {cause: err});
                this.logger.error(actionError);
            }
            actRes.success = false;
            actRes.result = err.message;
            return actRes;
        }
    }

    abstract process(item: Comment | Submission, ruleResults: RuleResultEntity[], options: runCheckOptions): Promise<ActionProcessResult>;

    getRuntimeAwareDryrun(options: runCheckOptions): boolean {
        const {dryRun: runtimeDryrun} = options;
        return runtimeDryrun || this.dryRun;
    }
}

export interface ActionOptions extends Omit<ActionConfig, 'authorIs' | 'itemIs'>, RunnableBaseOptions {
    //logger: Logger;
    subredditName: string;
    //resources: SubredditResources;
    client: ExtendedSnoowrap;
    emitter: EventEmitter
}

export interface ActionConfig extends RunnableBaseJson {
    /**
     * An optional, but highly recommended, friendly name for this Action. If not present will default to `kind`.
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * @examples ["myDescriptiveAction"]
     * */
    name?: string;
    /**
     * If `true` the Action will not make the API request to Reddit to perform its action.
     *
     * @default false
     * @examples [false, true]
     * */
    dryRun?: boolean;

    /**
     * If set to `false` the Action will not be run
     *
     * @default true
     * @examples [true]
     * */
    enable?: boolean
}

export interface ActionJson extends ActionConfig {
    /**
     * The type of action that will be performed
     */
    kind: ActionTypes
}

export interface StructuredActionJson extends Omit<ActionJson, 'itemIs' | 'authorIs'>, StructuredRunnableBase {

}

export const isActionJson = (obj: object): obj is ActionJson => {
    return (obj as ActionJson).kind !== undefined;
}

export default Action;

