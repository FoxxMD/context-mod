import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import {ManagerEntity} from "../ManagerEntity";
import dayjs, {Dayjs} from "dayjs";

export interface TotalStatOptions {
    metric: string
    value: number
    manager: ManagerEntity
    createdAt?: Dayjs | number
}

@Entity()
export class TotalStat {

    @PrimaryGeneratedColumn()
    id!: number;

    @Index()
    @Column({type: 'int', width: 13, nullable: false, readonly: true, unsigned: true})
    createdAt: number = dayjs().valueOf();

    @Column("varchar", {length: 60})
    metric!: string;

    @Column({type: 'bigint', unsigned: true})
    value!: number

    @ManyToOne(type => ManagerEntity)
    @JoinColumn({name: 'managerId'})
    manager!: ManagerEntity;

    @Column()
    managerId!: string

    constructor(data?: TotalStatOptions) {
        if (data !== undefined) {
            this.metric = data.metric;
            this.value = data.value;
            this.manager = data.manager;
            if (data.createdAt !== undefined) {
                if (typeof data.createdAt === 'number') {
                    this.createdAt = data.createdAt
                } else {
                    this.createdAt = data.createdAt.valueOf();
                }
            }
        }
    }
}
