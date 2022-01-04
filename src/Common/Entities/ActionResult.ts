import {Entity, Column, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {ActionedEvent} from "./ActionedEvent";
import {RulePremise} from "./RulePremise";

@Entity()
export class ActionResult {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 50})
    kind!: string;

    @Column("varchar", {length: 200, nullable: true})
    name!: string | undefined;

    @Column("boolean")
    run!: boolean;

    @Column("boolean")
    dryRun!: boolean;

    @Column("boolean")
    success!: boolean;

    @Column("text", {nullable: true})
    runReason!: string | undefined

    @Column("text", {nullable: true})
    result!: string | undefined

    @ManyToOne(type => ActionedEvent, act => act.actionResults)
    actionedEvent!: ActionedEvent;
}
