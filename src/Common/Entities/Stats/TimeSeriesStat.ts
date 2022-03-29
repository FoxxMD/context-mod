import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import {ManagerEntity} from "../ManagerEntity";
import dayjs, {Dayjs} from "dayjs";
import {TotalStatOptions} from "./TotalStat";
import {TimeAwareBaseEntity} from "../Base/TimeAwareBaseEntity";

export interface TimeSeriesStatOptions extends TotalStatOptions {
    granularity: string
}

@Entity()
export class TimeSeriesStat extends TimeAwareBaseEntity {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    granularity!: string

    @Column("varchar", {length: 60})
    metric!: string;

    @Column({type: 'decimal', precision: 12, scale: 2})
    value!: number

    @ManyToOne(type => ManagerEntity)
    @JoinColumn({name: 'managerId'})
    manager!: ManagerEntity;

    @Column()
    managerId!: string

    constructor(data?: TimeSeriesStatOptions) {
        super();
        if (data !== undefined) {
            this.metric = data.metric;
            this.value = data.value;
            this.manager = data.manager;
            this.granularity = data.granularity;
            if (data.createdAt !== undefined) {
                this.createdAt = data.createdAt
            }
        }
    }
}
