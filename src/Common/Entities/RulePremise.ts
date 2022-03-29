import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    JoinColumn,
    OneToMany,
    VersionColumn,
    ManyToOne,
    PrimaryColumn,
    CreateDateColumn, UpdateDateColumn, BeforeUpdate
} from "typeorm";
import {RuleResultEntity} from "./RuleResultEntity";
import {Rule} from "./Rule";
import {ObjectPremise} from "../interfaces";
import objectHash from "object-hash";
import {TimeAwareAndUpdatedBaseEntity} from "./Base/TimeAwareAndUpdatedBaseEntity";

export interface RulePremiseOptions {
    rule: Rule
    config: ObjectPremise
}

@Entity()
export class RulePremise extends TimeAwareAndUpdatedBaseEntity  {

    @ManyToOne(() => Rule, undefined,{cascade: ['insert'], eager: true})
    @JoinColumn({name: 'ruleId'})
    rule!: Rule;

    @PrimaryColumn()
    ruleId!: string;

    @PrimaryColumn("varchar", {length: 300})
    configHash!: string;

    @Column("simple-json")
    config!: ObjectPremise

    @OneToMany(type => RuleResultEntity, obj => obj.premise) // note: we will create author property in the Photo class below
    ruleResults!: RuleResultEntity[]

    @VersionColumn()
    version!: number;

    constructor(data?: RulePremiseOptions) {
        super();
        if(data !== undefined) {
            this.rule = data.rule;
            this.config = data.config;
            this.configHash = objectHash.sha1(data.config);
        }
    }
}
