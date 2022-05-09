import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    ManyToOne,
    OneToOne,
    CreateDateColumn,
    JoinColumn,
    OneToMany
} from "typeorm";
import {RulePremise} from "./RulePremise";
import {CheckResultEntity} from "./CheckResultEntity";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {FilterResult as IFilterResult, FilterResult} from "../interfaces";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {RuleSetResultEntity} from "./RuleSetResultEntity";
import {AuthorCriteria, TypedActivityState} from "../Infrastructure/Filters/FilterCriteria";

export interface RuleResultEntityOptions {
    triggered?: boolean
    result?: string
    fromCache?: boolean
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
    premise: RulePremise
    data?: any
}

@Entity({name: 'RuleResult'})
export class RuleResultEntity extends TimeAwareRandomBaseEntity {

    @Column("boolean", {nullable: true})
    triggered?: boolean;

    @Column("text", {nullable: true})
    result?: string

    @Column("boolean", {nullable: true})
    fromCache?: boolean

    @Column("simple-json", {nullable: true})
    data?: any

    @ManyToOne(type => RulePremise, act => act.ruleResults, {eager: true})
    @JoinColumn({name: 'premiseId'})
    premise!: RulePremise;

    // @ManyToOne(type => CheckResultEntity, act => act.ruleResults, {nullable: true})
    // checkResult?: CheckResultEntity;
    //

    @OneToOne(() => ActivityStateFilterResult, {nullable: true, cascade: ['insert'], eager: true})
    @JoinColumn({name: 'itemIs'})
    _itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true, cascade: ['insert'], eager: true})
    @JoinColumn({name: 'authorIs'})
    _authorIs?: AuthorFilterResult

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

    constructor(data?: RuleResultEntityOptions) {
        super();
        if (data !== undefined) {
            this.triggered = data.triggered;
            this.result = data.result;
            this.fromCache = data.fromCache;
            this.data = data.data;
            this.itemIs = data.itemIs ? new ActivityStateFilterResult(data.itemIs) : undefined;
            this.authorIs = data.authorIs ? new AuthorFilterResult(data.authorIs) : undefined;
            this.premise = data.premise;
        }
    }
}
