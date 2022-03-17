import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {Manager} from "./Manager";
import {Activity} from "./Activity";
import {RunResult} from "./RunResult";
import {Check} from "./Check";

@Entity()
export class Run  {

    @PrimaryColumn("varchar", {length: 300})
    name!: string;

    @ManyToOne(type => Manager, act => act.runs, {cascade: ['insert']})
    manager!: Activity;

    @OneToMany(type => RunResult, obj => obj.run, {cascade: ['insert']}) // note: we will create author property in the Photo class below
    results!: RunResult[]

    @OneToMany(type => Check, obj => obj.run, {cascade: ['insert']}) // note: we will create author property in the Photo class below
    checks!: Check[]
}
