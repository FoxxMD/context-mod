import Snoowrap, {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Logger} from "winston";
import {findResultByPremise, mergeArr} from "../util";
import {
    ObjectPremise,
    ResultContext,
    RuleResult as IRuleResult
} from "../Common/interfaces";
import {runCheckOptions} from "../Subreddit/Manager";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {RuleType} from "../Common/Entities/RuleType";
import {RulePremise} from "../Common/Entities/RulePremise";
import {capitalize} from "lodash";
import {RunnableBase} from "../Common/RunnableBase";
import {FindOptionsWhere} from "typeorm/find-options/FindOptionsWhere";
import {RunnableBaseJson, RunnableBaseOptions, StructuredRunnableBase} from "../Common/Infrastructure/Runnable";

export interface RuleOptions extends RunnableBaseOptions {
    name?: string;
    subredditName: string;
    client: Snoowrap
}

export interface Triggerable {
    run(item: Comment | Submission, existingResults: RuleResultEntity[], options: runCheckOptions): Promise<[(boolean | null), RuleResultEntity?]>;
}

export abstract class Rule extends RunnableBase implements Omit<IRule, 'authorIs' | 'itemIs'>, Triggerable {
    name?: string;
    logger: Logger
    client: Snoowrap;
    rulePremiseEntity: RulePremise | null = null;

    constructor(options: RuleOptions) {
        super(options);
        const {
            name,
            logger,
            subredditName,
            client,
        } = options;
        this.name = name;
        this.client = client;

        this.logger = logger.child({labels: [`Rule ${this.getRuleUniqueName()}`]}, mergeArr);
    }

    async initialize() {
        if (this.rulePremiseEntity === null) {
            const prem = this.getPremise();
            const kind = await this.resources.database.getRepository(RuleType).findOne({where: {name: this.getKind()}});
            const candidatePremise = new RulePremise({
                kind: kind as RuleType,
                config: prem,
                manager: this.resources.managerEntity,
                name: this.name,
            });

            const rulePremiseRepo = this.resources.database.getRepository(RulePremise);

            const searchCriteria: FindOptionsWhere<RulePremise> = {
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

                this.rulePremiseEntity = await rulePremiseRepo.findOne({
                    where: searchCriteria
                });
                if (this.rulePremiseEntity === null) {
                    this.rulePremiseEntity = await rulePremiseRepo.save(candidatePremise);
                }
            } catch (err) {
                const f = err;
            }
        }
    }

    async run(item: Comment | Submission, existingResults: RuleResultEntity[] = [], options: runCheckOptions): Promise<[(boolean | null), RuleResultEntity]> {

        const res = new RuleResultEntity({
            premise: this.rulePremiseEntity as RulePremise
        });

        try {
            const existingResult = findResultByPremise(this.rulePremiseEntity as RulePremise, existingResults);
            if (existingResult !== undefined) {
                this.logger.debug(`Returning existing result of ${existingResult.triggered ? '✔️' : '❌'}`);
                return Promise.resolve([existingResult.triggered ?? null, existingResult]);
            }

            const filterResults = await this.runFilters(item, options);
            const [itemRes, authorRes] = filterResults;
            res.itemIs = itemRes;
            res.authorIs = authorRes;

            if (itemRes !== undefined && !itemRes.passed) {
                const filterBehavior = (this.itemIs.exclude ?? []).length > 0 ? 'exclusive' : 'inclusive';
                this.logger.verbose(`${filterBehavior} Item did not pass 'itemIs' test`);
                res.result = `${filterBehavior} Item did not pass 'itemIs' test`;
                return Promise.resolve([false, res]);
            }
            if(authorRes !== undefined && !authorRes.passed) {
                const filterBehavior = (this.authorIs.exclude ?? []).length > 0 ? 'exclusive' : 'inclusive';
                this.logger.verbose(`${filterBehavior} Author criteria not matched`);
                res.result = `${filterBehavior} Item did not pass 'authorIs' test`;
                return Promise.resolve([false, res]);
            }
        } catch (err: any) {
            this.logger.error('Error occurred during Rule pre-process checks');
            throw err;
        }
        try {
            const [triggered, plainRuleResult] = await this.process(item);
            res.triggered = triggered;
            res.result = plainRuleResult.result;
            res.fromCache = false;
            res.data = plainRuleResult.data;
            return [triggered, res];
        } catch (err: any) {
            this.logger.error('Error occurred while processing rule');
            throw err;
        }
    }

    protected abstract process(item: Comment | Submission): Promise<[boolean, IRuleResult]>;

    abstract getKind(): string;

    getRuleUniqueName() {
        return this.name === undefined ? capitalize(this.getKind()) : `${capitalize(this.getKind())} - ${this.name}`;
    }

    protected abstract getSpecificPremise(): object;

    getPremise(): ObjectPremise {
        const config = this.getSpecificPremise();
        return {
            kind: this.getKind(),
            config,
            authorIs: this.authorIs,
            itemIs: this.itemIs,
        };
    }

    protected getResult(triggered: (boolean | null) = null, context: ResultContext = {}): IRuleResult {
        return {
            premise: this.getPremise(),
            kind: this.getKind(),
            name: this.getRuleUniqueName(),
            triggered,
            ...context,
        };
    }
}

export interface IRule extends RunnableBaseJson {
    /**
     * An optional, but highly recommended, friendly name for this rule. If not present will default to `kind`.
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * name is used to reference Rule result data during Action content templating. See CommentAction or ReportAction for more details.
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * @examples ["myNewRule"]
     * */
    name?: string
}

export interface RuleJSONConfig extends IRule {
    /**
     * The kind of rule to run
     * @examples ["recentActivity", "repeatActivity", "author", "attribution", "history"]
     */
    kind: 'recentActivity' | 'repeatActivity' | 'author' | 'attribution' | 'history' | 'regex' | 'repost' | 'sentiment'
}


export interface StructuredRuleJson extends Omit<RuleJSONConfig, 'authorIs' | 'itemIs'>, StructuredRunnableBase {

}
