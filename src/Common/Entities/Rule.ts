import {Entity, Column, ManyToOne, PrimaryColumn, OneToMany} from "typeorm";
import {RuleType} from "./RuleType";
import {Manager} from "./Manager";
import {ObjectPremise} from "../interfaces";
import objectHash from "object-hash";
import {RuleResult} from "./RuleResult";
import {RulePremise} from "./RulePremise";

export interface RuleEntityOptions {
    name?: string
    premise?: ObjectPremise
    kind?: RuleType
    manager?: Manager
}

@Entity()
export class Rule {

    @PrimaryColumn("varchar", {length: 300})
    id!: string;

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => RuleType, undefined, {cascade: ['insert'], eager: true})
    kind!: RuleType;

    @ManyToOne(type => Manager, act => act.rules, {cascade: ['insert']})
    manager!: Manager;

    @OneToMany(type => RulePremise, obj => obj.rule) // note: we will create author property in the Photo class below
    premises!: RulePremise[]

    constructor(data?: RuleEntityOptions) {
        if (data !== undefined) {
            if (data.kind !== undefined) {
                this.kind = data.kind;
            }
            if (data.manager !== undefined) {
                this.manager = data.manager;
            }
            if (data.name !== undefined && data.name !== this.kind.name) {
                this.name = data.name;
            } else if (data.premise !== undefined) {
                this.name = objectHash.sha1(data.premise);
            }
        }
    }
}
