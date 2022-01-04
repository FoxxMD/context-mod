import {Entity, Column, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {ActionedEvent} from "./ActionedEvent";
import {RulePremise} from "./RulePremise";

@Entity()
export class ActionResult {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 50})
    kind!: string;

    @Column("varchar", {length: 200})
    name!: string;

    @Column("boolean")
    run!: boolean;

    @Column("boolean")
    dryRun!: boolean;

    @Column("boolean")
    success!: boolean;

    @Column("text")
    runReason!: string

    @Column("text")
    result!: string

    @ManyToOne(type => ActionedEvent, act => act.actionResults)
    actionedEvent!: ActionedEvent;
}
