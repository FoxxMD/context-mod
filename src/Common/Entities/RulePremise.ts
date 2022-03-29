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
import {TimeAwareBaseEntity} from "./Base/TimeAwareBaseEntity";
import dayjs, {Dayjs} from "dayjs";

export interface RulePremiseOptions {
    rule: Rule
    config: ObjectPremise
}

@Entity()
export class RulePremise extends TimeAwareBaseEntity  {

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

    @Column({ type: 'bigint', width: 13, nullable: false, readonly: true, unsigned: true })
    updatedAt: Dayjs = dayjs();

    convertToDayjs() {
        if(this.createdAt !== undefined) {
            this.createdAt = dayjs(this.createdAt);
        }
        if(this.updatedAt !== undefined) {
            this.updatedAt = dayjs(this.createdAt);
        }
    }

    public convertToUnix() {
        // @ts-ignore
        this.createdAt = this.createdAt.valueOf();
        // @ts-ignore
        this.updatedAt = this.updatedAt.valueOf();
    }

    @BeforeUpdate()
    public updateTimestamp() {
        this.updatedAt = dayjs();
    }

    constructor(data?: RulePremiseOptions) {
        super();
        if(data !== undefined) {
            this.rule = data.rule;
            this.config = data.config;
            this.configHash = objectHash.sha1(data.config);
        }
    }
}
