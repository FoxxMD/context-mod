import {BeforeInsert, Entity, Column, AfterLoad} from "typeorm";
import dayjs, {Dayjs} from "dayjs";
import {RandomIdBaseEntity} from "./RandomIdBaseEntity";

export abstract class TimeAwareRandomBaseEntity extends RandomIdBaseEntity {

    @Column({ name: 'createdAt', nullable: false })
    _createdAt: Date = new Date();

    public get createdAt(): Dayjs {
        return dayjs(this._createdAt);
    }

    public set createdAt(d: Dayjs) {
        this._createdAt = d.utc().toDate();
    }
}
