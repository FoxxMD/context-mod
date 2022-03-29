import {BeforeInsert, Entity, Column, AfterLoad, BeforeUpdate} from "typeorm";
import dayjs, {Dayjs} from "dayjs";
import {TimeAwareBaseEntity} from "./TimeAwareBaseEntity";

export abstract class TimeAwareAndUpdatedBaseEntity extends TimeAwareBaseEntity  {

    @Column({ name: 'updatedAt', nullable: false })
    _updatedAt: Date = new Date();

    public get updatedAt(): Dayjs {
        return dayjs(this._updatedAt);
    }

    public set updatedAt(d: Dayjs) {
        this._updatedAt = d.utc().toDate();
    }

    @BeforeUpdate()
    public updateAt() {
        this.updatedAt = dayjs().utc()
    }
}
