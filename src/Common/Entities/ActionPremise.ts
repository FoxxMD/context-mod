import {Entity, Column, PrimaryGeneratedColumn, OneToMany, VersionColumn, ManyToOne} from "typeorm";
import {RuleResult} from "./RuleResult";
import {Rule} from "./Rule";
import {Action} from "./Action";
import {ActionResult} from "./ActionResult";

@Entity()
export class ActionPremise  {

    @PrimaryGeneratedColumn()
    id!: number;

    @ManyToOne(() => Action, undefined,{cascade: ['insert'], eager: true})
    rule!: Action;

    @Column("simple-json")
    config!: any

    @Column("varchar", {length: 300})
    configHash!: string;

    @OneToMany(type => ActionResult, obj => obj.premise) // note: we will create author property in the Photo class below
    actionResults!: ActionResult[]

    @VersionColumn()
    version!: number;
}
