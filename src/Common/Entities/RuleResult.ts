import {Entity, Column, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {ActionedEvent} from "./ActionedEvent";
import {RulePremise} from "./RulePremise";

@Entity()
export class RuleResult {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 50})
    kind!: string;

    @Column("varchar", {length: 200})
    name!: string;

    @Column("boolean")
    triggered!: boolean;

    @Column("text")
    result!: string

    @Column("simple-json")
    data!: any

    @ManyToOne(type => ActionedEvent, act => act.ruleResults)
    actionedEvent!: ActionedEvent;

    @ManyToOne(type => RulePremise, act => act.ruleResults, {cascade: ['insert']})
    premise!: RulePremise;
}
