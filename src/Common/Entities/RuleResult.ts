import {Entity, Column, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {ActionedEvent} from "./ActionedEvent";
import {RulePremise} from "./RulePremise";

@Entity()
export class RuleResult {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("boolean", {nullable: true})
    triggered!: boolean | null;

    @Column("text", {nullable: true})
    result!: string | undefined

    @Column("simple-json", {nullable: true})
    data!: any

    @ManyToOne(type => ActionedEvent, act => act.ruleResults)
    actionedEvent!: ActionedEvent;

    @ManyToOne(type => RulePremise, act => act.ruleResults, {cascade: ['insert']})
    premise!: RulePremise;
}
