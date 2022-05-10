import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {ManagerEntity} from "./ManagerEntity";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {ActivitySourceData} from "../interfaces";
import {CMEvent} from "./CMEvent";
import {removeUndefinedKeys} from "../../util";
import objectHash from "object-hash";
import {Duration} from "dayjs/plugin/duration";
import dayjs from "dayjs";
import {ColumnDurationTransformer} from "./Transformers";
import {ActivitySourceTypes, PollOn} from "../Infrastructure/Atomic";

export interface ActivitySourceEntityOptions extends ActivitySourceData {
    manager: ManagerEntity
}

@Entity({name: "ActivitySource"})
export class ActivitySourceEntity {

    @PrimaryColumn('varchar', {length: 50, comment: 'hash generated from object properties'})
    id!: string

    @Column("varchar", {length: 30})
    type!: ActivitySourceTypes;

    @Column("varchar", {length: 100, nullable: true})
    identifier?: PollOn | string

    @Column("varchar", {length: 100, nullable: true})
    action?: string

    @Column({
        type: 'int',
        nullable: true,
        unsigned: true,
        transformer: new ColumnDurationTransformer()
    })
    delay?: Duration

    @Column("varchar", {length: 100, nullable: true})
    goto?: string

    @ManyToOne(type => ManagerEntity)
    manager!: ManagerEntity;

    @OneToMany(type => CMEvent, obj => obj.source)
    events!: CMEvent[]

    constructor(data?: ActivitySourceEntityOptions) {
        if (data !== undefined) {
            this.type = data.type;
            this.identifier = data.identifier;
            this.action = data.action;
            this.delay = data.delay;
            this.goto = data.goto;
            this.manager = data.manager;

            const {manager, id, queuedAt, ...rest} = data;
            const hashObj = removeUndefinedKeys({
                ...rest,
                managerId: manager.id
            }) as object;
            this.id = objectHash.sha1(hashObj);
        }
    }
}
