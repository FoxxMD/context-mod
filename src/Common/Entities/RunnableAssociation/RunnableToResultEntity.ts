import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    ManyToOne,
    OneToOne,
    CreateDateColumn,
    JoinColumn,
    OneToMany, TableInheritance, AfterLoad
} from "typeorm";
import {CheckResultEntity} from "../CheckResultEntity";
import {TimeAwareRandomBaseEntity} from "../Base/TimeAwareRandomBaseEntity";
import {RuleResultEntity} from "../RuleResultEntity";
import {RuleSetResultEntity} from "../RuleSetResultEntity";
import {RunResultEntity} from "../RunResultEntity";

export interface RunnableToRuleResultEntityOptions<T, U> {
    result: U
    order: number
    runnable: T
}

@Entity({name: 'RunnableResult'})
@TableInheritance({column: {type: "varchar", name: "type"}})
export abstract class RunnableToResultEntity<T extends CheckResultEntity | RuleSetResultEntity | RunResultEntity, U extends RuleResultEntity | CheckResultEntity | RuleSetResultEntity> extends TimeAwareRandomBaseEntity {

    @Column()
    order!: number

    // @ManyToOne(type => RuleResultEntity, {cascade: ['insert'], eager: true})
    result!: U

    // @ManyToOne(type => T, act => act.runnable)
    runnable?: T;

    constructor(data?: RunnableToRuleResultEntityOptions<T, U>) {
        super();
        if (data !== undefined) {
            this.order = data.order;
            this.runnable = data.runnable;
            this.result = data.result;
        }
    }
}
