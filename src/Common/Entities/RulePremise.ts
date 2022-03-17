import {Entity, Column, PrimaryGeneratedColumn, OneToMany, VersionColumn, ManyToOne} from "typeorm";
import {RuleResult} from "./RuleResult";
import {Rule} from "./Rule";

@Entity()
export class RulePremise  {

    @PrimaryGeneratedColumn()
    id!: number;

    @ManyToOne(() => Rule, undefined,{cascade: ['insert'], eager: true})
    rule!: Rule;

    @Column("simple-json")
    config!: any

    @Column("varchar", {length: 300})
    configHash!: string;

    @OneToMany(type => RuleResult, obj => obj.premise) // note: we will create author property in the Photo class below
    ruleResults!: RuleResult[]

    @VersionColumn()
    version!: number;
}
