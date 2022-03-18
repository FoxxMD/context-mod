import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToOne} from "typeorm";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckResult} from "./CheckResult";
import {ActionPremise} from "./ActionPremise";

@Entity()
export class ActionResult {

    @PrimaryGeneratedColumn()
    id!: number;

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

    @ManyToOne(type => ActionPremise, act => act.actionResults, {cascade: ['insert']})
    premise!: ActionPremise;
}
