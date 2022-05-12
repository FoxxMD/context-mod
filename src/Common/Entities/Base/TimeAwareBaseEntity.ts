import {BeforeInsert, Entity, Column, AfterLoad, BeforeUpdate} from "typeorm";
import dayjs, {Dayjs} from "dayjs";

export abstract class TimeAwareBaseEntity {

    @Column({ name: 'createdAt', nullable: false })
    _createdAt: Date = new Date();

    public get createdAt(): Dayjs {
        return dayjs(this._createdAt);
    }

    public set createdAt(d: Dayjs) {
        this._createdAt = d.utc().toDate();
    }

    toJSON() {
        const jsonObj: any = Object.assign({}, this);
        const proto = Object.getPrototypeOf(this);
        for (const key of Object.getOwnPropertyNames(proto)) {
            const desc = Object.getOwnPropertyDescriptor(proto, key);
            const hasGetter = desc && typeof desc.get === 'function';
            if (hasGetter) {
                jsonObj[key] = (this as any)[key];
            }
        }
        return jsonObj;
    }
}
