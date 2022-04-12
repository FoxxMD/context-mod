import {ChildEntity, ManyToOne} from "typeorm";
import {RunnableToResultEntity} from "./RunnableToResultEntity";
import {CheckResultEntity} from "../CheckResultEntity";
import {RuleSetResultEntity} from "../RuleSetResultEntity";
import {RuleResultEntity} from "../RuleResultEntity";


@ChildEntity()
export class RuleSetToRuleResultEntity extends RunnableToResultEntity<RuleSetResultEntity, RuleResultEntity> {

    @ManyToOne(type => RuleSetResultEntity, act => act._ruleResults)
    runnable?: RuleSetResultEntity;

    @ManyToOne(type => RuleResultEntity, {cascade: ['insert'], eager: true})
    result!: RuleResultEntity
}
