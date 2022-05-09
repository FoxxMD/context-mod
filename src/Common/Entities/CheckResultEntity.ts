import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    OneToOne,
    ManyToOne,
    PrimaryColumn,
    JoinColumn, CreateDateColumn, AfterLoad
} from "typeorm";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckEntity} from "./CheckEntity";
import {RunResultEntity} from "./RunResultEntity";
import {RuleResultEntity} from "./RuleResultEntity";
import {ActionResultEntity} from "./ActionResultEntity";
import {
    FilterResult as IFilterResult,
    FilterResult,
    RuleSetResult
} from "../interfaces";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {RuleSetResultEntity} from "./RuleSetResultEntity";
import {CheckToRuleResultEntity} from "./RunnableAssociation/CheckToRuleResultEntity";
import {CheckToRuleSetResultEntity} from "./RunnableAssociation/CheckToRuleSetResultEntity";
import {isRuleSetResult} from "../../util";
import {JoinOperands, RecordOutputType} from "../Typings/Atomic";
import {AuthorCriteria, TypedActivityState} from "../Typings/Filters/FilterCriteria";

export interface CheckResultEntityOptions {
    triggered: boolean
    fromCache?: boolean
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
    ruleResults?: (RuleResultEntity | RuleSetResultEntity)[]
    actionResults?: ActionResultEntity[]
    error?: string
    condition: JoinOperands
    check: CheckEntity
    run: RunResultEntity
    postBehavior: string;
    recordOutputs?: RecordOutputType[];
}

@Entity({name: 'CheckResult'})
export class CheckResultEntity extends TimeAwareRandomBaseEntity {

    @ManyToOne(type => CheckEntity, act => act.results, {eager: true})
    check!: CheckEntity;

    @ManyToOne(type => RunResultEntity, act => act.checkResults, /*{cascade: ['insert']}*/)
    run!: RunResultEntity;

    @Column("boolean")
    triggered!: boolean;

    @Column("boolean", {nullable: true})
    fromCache?: boolean;

    @Column("varchar", {length: 20})
    condition!: JoinOperands

    @Column("text", {nullable: true})
    error?: string;

    @OneToOne(() => ActivityStateFilterResult, {nullable: true, cascade: ['insert'], eager: true})
    @JoinColumn({name: 'itemIs'})
    _itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true, cascade: ['insert'], eager: true})
    @JoinColumn({name: 'authorIs'})
    _authorIs?: AuthorFilterResult

    @Column("varchar", {length: 50, nullable: true})
    postBehavior!: string

    @Column('simple-array', {nullable: true})
    recordOutputs?: RecordOutputType[];

    @OneToMany(type => CheckToRuleResultEntity, obj => obj.runnable, {cascade: ['insert'], nullable: true, eager: true})
    ruleResults?: CheckToRuleResultEntity[]

    @OneToMany(type => CheckToRuleSetResultEntity, obj => obj.runnable, {
        cascade: ['insert'],
        nullable: true,
        eager: true
    })
    ruleSetResults?: CheckToRuleSetResultEntity[]

    @OneToMany(type => ActionResultEntity, obj => obj.checkResult, {cascade: ['insert'], nullable: true, eager: true})
    actionResults?: ActionResultEntity[]

    @AfterLoad()
    sortRuns() {
        if (this.ruleResults !== undefined) {
            this.ruleResults.sort((a, z) => a.order - z.order);
        }
        if (this.ruleSetResults !== undefined) {
            this.ruleSetResults.sort((a, z) => a.order - z.order);
        }
        if (this.actionResults !== undefined) {
            this.actionResults.sort((a, b) => a.createdAt.isSameOrBefore(b.createdAt) ? -1 : 1);
        }
    }

    set itemIs(data: ActivityStateFilterResult | IFilterResult<TypedActivityState> | undefined) {
        if (data === undefined) {
            this._itemIs = undefined;
        } else if (data instanceof ActivityStateFilterResult) {
            this._itemIs = data;
        } else {
            this._itemIs = new ActivityStateFilterResult(data);
        }
    }

    get itemIs() {
        return this._itemIs;
    }

    set authorIs(data: AuthorFilterResult | IFilterResult<AuthorCriteria> | undefined) {
        if (data === undefined) {
            this._authorIs = undefined;
        } else if (data instanceof AuthorFilterResult) {
            this._authorIs = data;
        } else {
            this._authorIs = new AuthorFilterResult(data);
        }
    }

    get authorIs() {
        return this._authorIs;
    }

    get results(): (RuleResultEntity | RuleSetResultEntity)[] {
        let allResults: (CheckToRuleResultEntity | CheckToRuleSetResultEntity)[] = this.ruleResults ?? [];
        allResults = allResults.concat(this.ruleSetResults ?? []);
        allResults.sort((a, z) => a.order - z.order);
        return allResults.map(x => x.result);
    }

    get allRuleResults(): RuleResultEntity[] {
        return this.results.map(x => x instanceof RuleSetResultEntity ? x.results : x).flat();
    }

    set results(data: (RuleResultEntity | RuleSetResultEntity | RuleSetResult)[]) {
        let index = 0;
        for (const x of data) {
            index++;
            let realVal = x;
            if(isRuleSetResult(x)) {
                realVal = new RuleSetResultEntity({...(x as RuleSetResult)});
            }
            if (realVal instanceof RuleSetResultEntity) {
                if (this.ruleSetResults === undefined) {
                    this.ruleSetResults = [];
                }
                this.ruleSetResults.push(new CheckToRuleSetResultEntity({
                    result: realVal,
                    runnable: this,
                    order: index
                }));
            } else if(realVal instanceof RuleResultEntity) {
                if (this.ruleResults === undefined) {
                    this.ruleResults = [];
                }
                this.ruleResults.push(new CheckToRuleResultEntity({
                    result: realVal,
                    runnable: this,
                    order: index
                }))
            }
        }
    }

    constructor(data?: CheckResultEntityOptions) {
        super();
        if (data !== undefined) {
            this.triggered = data.triggered;
            this.fromCache = data.fromCache;
            this.condition = data.condition;
            this.error = data.error;
            this.itemIs = data.itemIs ? new ActivityStateFilterResult(data.itemIs) : undefined;
            this.authorIs = data.authorIs ? new AuthorFilterResult(data.authorIs) : undefined;
            if (data.ruleResults !== undefined) {
                this.results = data.ruleResults;
            }
            this.actionResults = data.actionResults;
            this.check = data.check;
            this.postBehavior = data.postBehavior;
            this.recordOutputs = data.recordOutputs;
        }
    }

    toJSON() {
        const data = super.toJSON();
        data['ruleResults'] = [...data.results];
        delete data['ruleSetResults'];
        delete data['allRuleResults'];
        delete data['results'];
        return data;
    }
}
