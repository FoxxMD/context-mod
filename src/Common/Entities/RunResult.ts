import {Entity, Column, PrimaryGeneratedColumn, OneToMany, OneToOne, ManyToOne, PrimaryColumn} from "typeorm";
import {Manager} from "./Manager";
import {Activity} from "./Activity";
import {Run} from "./Run";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckResult} from "./CheckResult";
import {RuleResult} from "./RuleResult";
import {CMEvent} from "./CMEvent";

@Entity()
export class RunResult  {

    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @ManyToOne(type => Run, act => act.results, {cascade: ['insert']})
    run!: Run;

    @ManyToOne(type => CMEvent, act => act.runResults, {cascade: ['insert']})
    event!: CMEvent;

    @Column("boolean")
    triggered!: boolean;

    @Column("text")
    reason!: string;

    @Column("text")
    error!: string;

    @OneToOne(() => ActivityStateFilterResult)
    itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult)
    authorIs?: AuthorFilterResult

    @OneToMany(type => CheckResult, obj => obj.run, {cascade: ['insert']})
    checkResults!: CheckResult[]
}
