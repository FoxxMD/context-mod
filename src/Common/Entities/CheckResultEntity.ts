import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    OneToOne,
    ManyToOne,
    PrimaryColumn,
    JoinColumn, CreateDateColumn
} from "typeorm";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckEntity} from "./CheckEntity";
import {RunResultEntity} from "./RunResultEntity";
import {RuleResultEntity} from "./RuleResultEntity";
import {ActionResultEntity} from "./ActionResultEntity";
import {FilterResult as IFilterResult, FilterResult, JoinOperands, TypedActivityState} from "../interfaces";
import {AuthorCriteria} from "../../Author/Author";

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
export class CheckResultEntity {

    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @ManyToOne(type => CheckEntity, act => act.results, /*{cascade: ['insert']}*/)
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

    @OneToOne(() => ActivityStateFilterResult, {nullable: true, cascade: ['insert']})
    @JoinColumn({name: 'itemIs'})
    private _itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true, cascade: ['insert']})
    @JoinColumn({name: 'authorIs'})
    private _authorIs?: AuthorFilterResult

    @Column("varchar", {length: 50, nullable: true})
    postBehavior!: string

    @OneToMany(type => RuleResultEntity, obj => obj.checkResult, {cascade: ['insert', 'update'], nullable: true})
    ruleResults?: RuleResultEntity[]

    @OneToMany(type => ActionResultEntity, obj => obj.checkResult, {cascade: ['insert', 'update'], nullable: true})
    actionResults?: ActionResultEntity[]

    @CreateDateColumn()
    createdAt!: number

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
