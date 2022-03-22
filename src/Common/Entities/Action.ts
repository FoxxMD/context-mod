import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {ActionType} from "./ActionType";
import {ManagerEntity} from "./ManagerEntity";
import objectHash from "object-hash";
import {ObjectPremise} from "../interfaces";

export interface ActionEntityOptions {
    name?: string
    premise: ObjectPremise
    kind?: ActionType
    manager?: ManagerEntity
}

@Entity()
export class Action  {

    @PrimaryColumn("varchar", {length: 300})
    id!: string;

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => ActionType, undefined,{cascade: ['insert'], eager: true})
    kind!: ActionType;

    @ManyToOne(type => ManagerEntity, act => act.actions, {cascade: ['insert']})
    manager!: ManagerEntity;

    constructor(data?: ActionEntityOptions) {
        if (data !== undefined) {
            if (data.kind !== undefined) {
                this.kind = data.kind;
            }
            if (data.manager !== undefined) {
                this.manager = data.manager;
            }
            if(data.name !== undefined) {
                this.name = data.name;
                this.id = data.name;
            } else {
                this.id = objectHash.sha1(data.premise);
            }
        }
    }
}
