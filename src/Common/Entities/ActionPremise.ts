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
import {TimeAwareAndUpdatedBaseEntity} from "./Base/TimeAwareAndUpdatedBaseEntity";

export interface ActionPremiseOptions {
    action: Action
    config: ObjectPremise
}

@Entity()
export class ActionPremise extends TimeAwareAndUpdatedBaseEntity  {

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

    constructor(data?: ActionPremiseOptions) {
        super();
        if(data !== undefined) {
            this.action = data.action;
            this.config = data.config;
            this.configHash = objectHash.sha1(data.config);
        }
    }
}
