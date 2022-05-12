import {ChildEntity, ManyToOne} from "typeorm";
import {RunnableToResultEntity} from "./RunnableToResultEntity";
import {CheckResultEntity} from "../CheckResultEntity";
import {RuleResultEntity} from "../RuleResultEntity";
import {RunResultEntity} from "../RunResultEntity";
import {RuleSetResultEntity} from "../RuleSetResultEntity";


@ChildEntity()
export class CheckToRuleSetResultEntity extends RunnableToResultEntity<CheckResultEntity, RuleSetResultEntity> {

    @ManyToOne(type => CheckResultEntity, act => act.ruleSetResults)
    runnable?: CheckResultEntity;

    @ManyToOne(type => RuleSetResultEntity, {cascade: ['insert'], eager: true})
    result!: RuleSetResultEntity
}
