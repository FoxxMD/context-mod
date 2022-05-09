import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {CheckResultEntity} from "./CheckResultEntity";
import {RunEntity} from "./RunEntity";
import {ManagerEntity} from "./ManagerEntity";
import {ActivityType} from "../Typings/Reddit";

export interface CheckEntityOptions {
    name: string
    type: ActivityType
    run: RunEntity
    manager: ManagerEntity
}

@Entity({name: 'Check'})
export class CheckEntity {

    @PrimaryColumn("varchar", {length: 300})
    name!: string;

    @Column("varchar", {length: 20})
    type!: ActivityType

    @OneToMany(type => CheckResultEntity, obj => obj.run, {cascade: ['insert']})
    results!: CheckResultEntity[]

    @ManyToOne(type => RunEntity, act => act.checks)
    run!: RunEntity;

    @ManyToOne(type => ManagerEntity, act => act.checks)
    manager!: ManagerEntity;

    constructor(data?: CheckEntityOptions) {
        if (data !== undefined) {
            this.name = data.name;
            this.type = data.type;
            this.run = data.run;
            this.manager = data.manager;
        }
    }
}
