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

    @Column({ type: 'datetime', nullable: false, readonly: true })
    updatedAt: Dayjs = dayjs();

    convertToDomain() {
        if(this.createdAt !== undefined) {
            this.createdAt = dayjs(this.createdAt);
        }
        if(this.updatedAt !== undefined) {
            this.updatedAt = dayjs(this.createdAt);
        }
    }

    public convertToDatabase() {
        if(dayjs.isDayjs(this.createdAt)) {
            // @ts-ignore
            this.createdAt = this.createdAt.toDate();
        }
        if(dayjs.isDayjs(this.updatedAt)) {
            // @ts-ignore
            this.updatedAt = this.updatedAt.toDate();
        }
    }

    @BeforeUpdate()
    public updateTimestamp() {
        // @ts-ignore
        this.updatedAt = dayjs().toDate();
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
