import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {CheckResult} from "./CheckResult";
import {RunResult} from "./RunResult";
import {Run} from "./Run";
import {Manager} from "./Manager";
import {Activity} from "./Activity";

@Entity()
export class Check  {

    @PrimaryColumn("varchar", {length: 300})
    name!: string;

    @Column("varchar", {length: 20})
    type!: 'submission' | 'comment'

    @OneToMany(type => CheckResult, obj => obj.run, {cascade: ['insert']}) // note: we will create author property in the Photo class below
    results!: CheckResult[]

    @ManyToOne(type => Run, act => act.checks, {cascade: ['insert']})
    run!: Run;

    @ManyToOne(type => Manager, act => act.checks, {cascade: ['insert']})
    manager!: Activity;
}
