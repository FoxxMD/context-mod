import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    VersionColumn,
    ManyToOne,
    JoinColumn,
    PrimaryColumn, CreateDateColumn, UpdateDateColumn, BeforeInsert, BeforeUpdate
} from "typeorm";
import {Action} from "./Action";
import {ActionResultEntity} from "./ActionResultEntity";
import objectHash from "object-hash";
import {ObjectPremise} from "../interfaces";
import {TimeAwareBaseEntity} from "./Base/TimeAwareBaseEntity";
import dayjs, {Dayjs} from "dayjs";

export interface ActionPremiseOptions {
    action: Action
    config: ObjectPremise
}

@Entity()
export class ActionPremise extends TimeAwareBaseEntity  {

    @ManyToOne(() => Action, undefined,{cascade: ['insert'], eager: true})
    @JoinColumn({name: 'actionId'})
    action!: Action;

    @PrimaryColumn()
    actionId!: string;

    @Column("simple-json")
    config!: ObjectPremise

    @PrimaryColumn("varchar", {length: 300})
    configHash!: string;

    @OneToMany(type => ActionResultEntity, obj => obj.premise) // note: we will create author property in the Photo class below
    actionResults!: ActionResultEntity[]

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

    constructor(data?: ActionPremiseOptions) {
        super();
        if(data !== undefined) {
            this.action = data.action;
            this.config = data.config;
            this.configHash = objectHash.sha1(data.config);
        }
    }
}
