import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    ManyToOne,
    OneToOne,
    CreateDateColumn,
    JoinColumn,
    OneToMany, AfterLoad
} from "typeorm";
import {RulePremise} from "./RulePremise";
import {CheckResultEntity} from "./CheckResultEntity";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {
    FilterResult as IFilterResult,
    FilterResult
} from "../interfaces";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {RuleResultEntity} from "./RuleResultEntity";
import {RuleSetToRuleResultEntity} from "./RunnableAssociation/RuleSetToRuleResultEntity";
import {JoinOperands} from "../Infrastructure/Atomic";
import {AuthorCriteria, TypedActivityState} from "../Infrastructure/Filters/FilterCriteria";

export interface RuleSetResultEntityOptions {
    triggered: boolean
    condition: JoinOperands
    results: RuleResultEntity[]
    //checkResult: CheckResultEntity
}

@Entity({name: 'RuleSetResult'})
export class RuleSetResultEntity extends TimeAwareRandomBaseEntity {

    @Column("boolean")
    triggered!: boolean;

    @Column("varchar", {length: 20})
    condition!: JoinOperands

    @OneToMany(type => RuleSetToRuleResultEntity, obj => obj.runnable, {cascade: ['insert'], eager: true})
    _ruleResults!: RuleSetToRuleResultEntity[]

    get results(): RuleResultEntity[] {
        const rules = [...this._ruleResults];
        rules.sort((a, z) => a.order - z.order);
        return rules.map(x => x.result);
    }

    set results(results: RuleResultEntity[]) {
        this._ruleResults = results.map((x, index) => new RuleSetToRuleResultEntity({
            result: x,
            runnable: this,
            order: index + 1
        }));
    }

    // @ManyToOne(type => CheckResultEntity, act => act.ruleSetResults)
    // checkResult!: CheckResultEntity;

    constructor(data?: RuleSetResultEntityOptions) {
        super();
        if (data !== undefined) {
            this.triggered = data.triggered;
            this.condition = data.condition;
            this._ruleResults = data.results.map((x, index) => new RuleSetToRuleResultEntity({
                result: x,
                runnable: this,
                order: index + 1
            }));
            // this.checkResult = data.checkResult;
        }
    }

    @AfterLoad()
    sortRuns() {
        if(this._ruleResults !== undefined) {
            this._ruleResults.sort((a, z) => a.order - z.order);
        }
    }

    toJSON(): any {
        const data = super.toJSON();
        delete data['_ruleResults'];
        data.results = this.results;
        return data;
    }
}
