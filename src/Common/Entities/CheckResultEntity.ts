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
import {FilterResult as IFilterResult, FilterResult, JoinOperands, TypedActivityState} from "../interfaces";
import {AuthorCriteria} from "../../Author/Author";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";

export interface CheckResultEntityOptions {
    triggered: boolean
    fromCache?: boolean
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
    ruleResults?: RuleResultEntity[]
    actionResults?: ActionResultEntity[]
    error?: string
    condition: JoinOperands
    check: CheckEntity
    run: RunResultEntity
    postBehavior: string;
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

    @OneToMany(type => RuleResultEntity, obj => obj.checkResult, {cascade: ['insert', 'update'], nullable: true, eager: true})
    ruleResults?: RuleResultEntity[]

    @OneToMany(type => ActionResultEntity, obj => obj.checkResult, {cascade: ['insert', 'update'], nullable: true, eager: true})
    actionResults?: ActionResultEntity[]

    @AfterLoad()
    sortRuns() {
        if(this.ruleResults !== undefined) {
            this.ruleResults.sort((a, b) => a.createdAt.isSameOrBefore(b.createdAt) ?  -1 : 1);
        }
        if(this.actionResults !== undefined) {
            this.actionResults.sort((a, b) => a.createdAt.isSameOrBefore(b.createdAt) ?  -1 : 1);
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

    constructor(data?: CheckResultEntityOptions) {
        super();
        if(data !== undefined) {
            this.triggered = data.triggered;
            this.fromCache = data.fromCache;
            this.condition = data.condition;
            this.error = data.error;
            this.itemIs = data.itemIs ? new ActivityStateFilterResult(data.itemIs) : undefined;
            this.authorIs = data.authorIs ? new AuthorFilterResult(data.authorIs) : undefined;
            this.ruleResults = data.ruleResults;
            this.actionResults = data.actionResults;
            this.check = data.check;
            this.postBehavior = data.postBehavior;
        }
    }
}
