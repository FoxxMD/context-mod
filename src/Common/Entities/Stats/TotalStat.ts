import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import {ManagerEntity} from "../ManagerEntity";
import dayjs, {Dayjs} from "dayjs";
import {TimeAwareBaseEntity} from "../Base/TimeAwareBaseEntity";

export interface TotalStatOptions {
    metric: string
    value: number
    manager: ManagerEntity
    createdAt?: Dayjs
}

@Entity()
export class TotalStat extends TimeAwareBaseEntity{

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 60})
    metric!: string;

    @Column({type: 'decimal', precision: 12, scale: 2})
    value!: number

    @ManyToOne(type => ManagerEntity)
    @JoinColumn({name: 'managerId'})
    manager!: ManagerEntity;

    @Column()
    managerId!: string

    constructor(data?: TotalStatOptions) {
        super();
        if (data !== undefined) {
            this.metric = data.metric;
            this.value = data.value;
            this.manager = data.manager;
            if (data.createdAt !== undefined) {
                this.createdAt = data.createdAt
            }
        }
    }
}
