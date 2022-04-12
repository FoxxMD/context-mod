import {ChildEntity, ManyToOne} from "typeorm";
import {RunnableToResultEntity} from "./RunnableToResultEntity";
import {CheckResultEntity} from "../CheckResultEntity";
import {RuleResultEntity} from "../RuleResultEntity";


@ChildEntity()
export class CheckToRuleResultEntity extends RunnableToResultEntity<CheckResultEntity, RuleResultEntity> {

    @ManyToOne(type => CheckResultEntity, act => act.ruleResults)
    runnable?: CheckResultEntity;

    @ManyToOne(type => RuleResultEntity, {cascade: ['insert'], eager: true})
    result!: RuleResultEntity
}
