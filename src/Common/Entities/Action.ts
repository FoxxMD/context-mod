import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {ActionType} from "./ActionType";
import {Manager} from "./Manager";
import {Activity} from "./Activity";
import {RuleResult} from "./RuleResult";
import {ActionResult} from "./ActionResult";

@Entity()
export class Action  {

    @PrimaryColumn("varchar", {length: 300})
    id!: string;

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => ActionType, undefined,{cascade: ['insert'], eager: true})
    kind!: ActionType;

    @ManyToOne(type => Manager, act => act.actions, {cascade: ['insert']})
    manager!: Activity;

    @OneToMany(type => ActionResult, obj => obj.action) // note: we will create author property in the Photo class below
    results!: ActionResult[]
}
