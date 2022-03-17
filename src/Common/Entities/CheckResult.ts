import {Entity, Column, PrimaryGeneratedColumn, OneToMany, OneToOne, ManyToOne, PrimaryColumn} from "typeorm";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {Check} from "./Check";
import {RunResult} from "./RunResult";
import {RuleResult} from "./RuleResult";
import {ActionResult} from "./ActionResult";

@Entity()
export class CheckResult  {

    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @ManyToOne(type => Check, act => act.results, {cascade: ['insert']})
    check!: Check;

    @ManyToOne(type => RunResult, act => act.checkResults, {cascade: ['insert']})
    run!: RunResult;

    @Column("boolean")
    triggered!: boolean;

    @Column("boolean")
    fromCache!: boolean;

    @Column("varchar", {length: 20})
    condition!: 'AND' | 'OR'

    @Column("text", {nullable: true})
    error?: string;

    @OneToOne(() => ActivityStateFilterResult, {nullable: true})
    itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true})
    authorIs?: AuthorFilterResult

    @Column("varchar", {length: 50, nullable: true})
    postBehavior?: string

    @OneToMany(type => RuleResult, obj => obj.checkResult, {cascade: ['insert'], nullable: true})
    ruleResults?: RuleResult[]

    @OneToMany(type => ActionResult, obj => obj.checkResult, {cascade: ['insert'], nullable: true})
    actionResults?: ActionResult[]
}
