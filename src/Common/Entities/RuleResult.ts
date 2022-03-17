import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToOne} from "typeorm";
import {RulePremise} from "./RulePremise";
import {CheckResult} from "./CheckResult";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";

@Entity()
export class RuleResult {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("boolean", {nullable: true})
    triggered!: boolean | null;

    @Column("text", {nullable: true})
    result?: string

    @Column("boolean", {nullable: true})
    fromCache?: boolean

    @Column("simple-json", {nullable: true})
    data!: any

    @ManyToOne(type => RulePremise, act => act.ruleResults, {cascade: ['insert']})
    premise!: RulePremise;

    @ManyToOne(type => CheckResult, act => act.ruleResults, {cascade: ['insert']})
    checkResult!: CheckResult;

    @OneToOne(() => ActivityStateFilterResult, {nullable: true})
    itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true})
    authorIs?: AuthorFilterResult
}
