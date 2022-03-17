import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToOne} from "typeorm";
import {RulePremise} from "./RulePremise";
import {Action} from "./Action";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckResult} from "./CheckResult";
import {ActionResult as IActionResult} from "../interfaces";

@Entity()
export class ActionResult {

    @PrimaryGeneratedColumn()
    id!: number;

    @ManyToOne(type => Action, act => act.results, {cascade: ['insert']})
    action!: Action;

    @Column("boolean")
    run!: boolean;

    @Column("boolean")
    dryRun!: boolean;

    @Column("boolean")
    success!: boolean;

    @Column("text", {nullable: true})
    runReason?: string

    @Column("text", {nullable: true})
    result?: string

    @OneToOne(() => ActivityStateFilterResult, {nullable: true})
    itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true})
    authorIs?: AuthorFilterResult

    @ManyToOne(type => CheckResult, act => act.actionResults, {cascade: ['insert']})
    checkResult!: CheckResult;
}
