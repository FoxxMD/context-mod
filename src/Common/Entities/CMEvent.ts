import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany} from "typeorm";
import {Activity} from "./Activity";
import {RuleResult} from "./RuleResult";
import {ActionResult} from "./ActionResult";
import {Manager} from "./Manager";
import {RunResult} from "./RunResult";

@Entity()
export class CMEvent {

    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column("varchar", {length: 300})
    check!: string;

    @Column("text")
    ruleSummary!: string;

    @Column("integer")
    timestamp!: number;

    @Column("boolean")
    triggered!: boolean;

    @ManyToOne(type => Manager, act => act.events, {cascade: ['insert']})
    manager!: Activity;

    @ManyToOne(type => Activity, act => act.actionedEvents, {cascade: ['insert']})
    activity!: Activity;

    @OneToMany(type => RunResult, obj => obj.event, {cascade: ['insert']})
    runResults!: RunResult[]
}
