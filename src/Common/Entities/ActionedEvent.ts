import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany} from "typeorm";
import {Activity} from "./Activity";
import {RuleResult} from "./RuleResult";
import {ActionResult} from "./ActionResult";

@Entity()
export class ActionedEvent {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 300})
    check!: string;

    @Column("text")
    ruleSummary!: string;

    @Column("date")
    timestamp!: number;

    @ManyToOne(type => Activity, act => act.actionedEvents, {cascade: ['insert']})
    activity!: Activity;

    @OneToMany(type => RuleResult, obj => obj.actionedEvent, {cascade: ['insert']}) // note: we will create author property in the Photo class below
    ruleResults!: RuleResult[]

    @OneToMany(type => ActionResult, obj => obj.actionedEvent, {cascade: ['insert']}) // note: we will create author property in the Photo class below
    actionResults!: ActionResult[]
}
