import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    JoinColumn,
    OneToMany,
    VersionColumn,
    ManyToOne,
    PrimaryColumn,
    CreateDateColumn, UpdateDateColumn
} from "typeorm";
import {RuleResult} from "./RuleResult";
import {Rule} from "./Rule";

@Entity()
export class RulePremise  {

    // @PrimaryGeneratedColumn()
    // id!: number;


    @ManyToOne(() => Rule, undefined,{cascade: ['insert'], eager: true})
    @JoinColumn({name: 'ruleId'})
    rule!: Rule;

    @PrimaryColumn()
    ruleId!: string;

    @PrimaryColumn("varchar", {length: 300})
    configHash!: string;

    @Column("simple-json")
    config!: any

    @OneToMany(type => RuleResult, obj => obj.premise) // note: we will create author property in the Photo class below
    ruleResults!: RuleResult[]

    @VersionColumn()
    version!: number;

    @CreateDateColumn()
    createdAt!: number

    @UpdateDateColumn()
    updatedAt!: number
}
