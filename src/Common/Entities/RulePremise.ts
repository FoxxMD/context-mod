import {Entity, Column, PrimaryGeneratedColumn, OneToMany} from "typeorm";
import {RuleResult} from "./RuleResult";

@Entity()
export class RulePremise  {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 50})
    kind!: string;

    @Column("simple-json")
    config!: any

    @OneToMany(type => RuleResult, obj => obj.premise) // note: we will create author property in the Photo class below
    ruleResults!: RuleResult[]
}
