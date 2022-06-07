import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {ManagerEntity} from "./ManagerEntity";
import {Activity} from "./Activity";
import {RunResultEntity} from "./RunResultEntity";
import {CheckEntity} from "./CheckEntity";

export interface RunEntityOptions {
    name: string
    manager: ManagerEntity
}

@Entity({name: 'Run'})
export class RunEntity {

    @PrimaryColumn("varchar", {length: 300})
    name!: string;

    @ManyToOne(type => ManagerEntity, act => act.runs)
    manager!: ManagerEntity;

    @OneToMany(type => RunResultEntity, obj => obj.run, {cascade: ['insert']})
    results!: RunResultEntity[]

    @OneToMany(type => CheckEntity, obj => obj.run)
    checks!: CheckEntity[]

    constructor(data?: RunEntityOptions) {
        if(data !== undefined) {
            this.name = data.name;
            this.manager = data.manager;
        }
    }
}
