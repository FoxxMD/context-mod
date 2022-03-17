import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {RuleResult} from "./RuleResult";
import {RulePremise} from "./RulePremise";
import {RuleType} from "./RuleType";
import {Manager} from "./Manager";
import {Activity} from "./Activity";

@Entity()
export class Rule  {

    @PrimaryColumn("varchar", {length: 300})
    id!: string;

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => RuleType, undefined,{cascade: ['insert'], eager: true})
    kind!: RuleType;

    @ManyToOne(type => Manager, act => act.rules, {cascade: ['insert']})
    manager!: Activity;
}
