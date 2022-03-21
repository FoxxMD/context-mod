import {Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, PrimaryColumn} from "typeorm";
import {ActionType} from "./ActionType";
import {Manager} from "./Manager";
import {Activity} from "./Activity";
import {RuleResult} from "./RuleResult";
import {ActionResult} from "./ActionResult";
import objectHash from "object-hash";
import {RuleEntityOptions} from "./Rule";
import {ObjectPremise} from "../interfaces";
import {RuleType} from "./RuleType";

export interface ActionEntityOptions {
    name?: string
    premise: ObjectPremise
    kind?: ActionType
    manager?: Manager
}

@Entity()
export class Action  {

    @PrimaryColumn("varchar", {length: 300})
    id!: string;

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => ActionType, undefined,{cascade: ['insert'], eager: true})
    kind!: ActionType;

    @ManyToOne(type => Manager, act => act.actions, {cascade: ['insert']})
    manager!: Manager;

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
