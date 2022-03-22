import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToOne} from "typeorm";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckResultEntity} from "./CheckResultEntity";
import {ActionPremise} from "./ActionPremise";

@Entity({name: 'ActionResult'})
export class ActionResultEntity {

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

    @OneToOne(() => ActivityStateFilterResult, {nullable: true, cascade: ['insert']})
    itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true, cascade: ['insert']})
    authorIs?: AuthorFilterResult

    @ManyToOne(type => CheckResultEntity, act => act.actionResults, /*{cascade: ['insert']}*/)
    checkResult!: CheckResultEntity;

    @ManyToOne(type => ActionPremise, act => act.actionResults, /*{cascade: ['insert']}*/)
    premise!: ActionPremise;
}
