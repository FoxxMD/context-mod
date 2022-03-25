import {Entity, Column, ManyToOne, PrimaryColumn, OneToMany} from "typeorm";
import {RuleType} from "./RuleType";
import {ManagerEntity} from "./ManagerEntity";
import {ObjectPremise} from "../interfaces";
import objectHash from "object-hash";
import {RuleResultEntity} from "./RuleResultEntity";
import {RulePremise} from "./RulePremise";
import {capitalize} from "lodash";

export interface RuleEntityOptions {
    name?: string
    premise: ObjectPremise
    kind?: RuleType
    manager?: ManagerEntity
}

@Entity()
export class Rule {

    @PrimaryColumn("varchar", {length: 300})
    id!: string;

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => RuleType, undefined, {eager: true})
    kind!: RuleType;

    @ManyToOne(type => ManagerEntity, act => act.rules)
    manager!: ManagerEntity;

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
            if(data.name !== undefined) {
                this.name = data.name;
                this.id = data.name;
            } else {
                this.id = objectHash.sha1(data.premise);
            }
        }
    }

    getFriendlyIdentifier() {
        return this.name === undefined ? capitalize(this.kind.name) : `${capitalize(this.kind.name)} - ${this.name}`;
    }

    static getFriendlyIdentifier(ruleLike: any) {
        const rule = ruleLike as Rule;

        return rule.name === undefined ? capitalize(rule.kind.name) : `${capitalize(rule.kind.name)} - ${rule.name}`;
    }
}
