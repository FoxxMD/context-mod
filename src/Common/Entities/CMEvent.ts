import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, CreateDateColumn} from "typeorm";
import {Activity} from "./Activity";
import {ManagerEntity} from "./ManagerEntity";
import {RunResultEntity} from "./RunResultEntity";
import {RandomIdBaseEntity} from "./RandomIdBaseEntity";

@Entity()
export class CMEvent extends RandomIdBaseEntity {

    @CreateDateColumn()
    createdAt!: number;

    @Column("boolean")
    triggered!: boolean;

    @ManyToOne(type => ManagerEntity, act => act.events)
    manager!: ManagerEntity;

    @ManyToOne(type => Activity, act => act.actionedEvents, {cascade: ['insert', 'update']})
    activity!: Activity;

    @OneToMany(type => RunResultEntity, obj => obj.event, {cascade: ['insert']})
    runResults!: RunResultEntity[]
}
