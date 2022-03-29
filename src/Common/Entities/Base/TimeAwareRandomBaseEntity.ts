import {BeforeInsert, Entity, Column, AfterLoad} from "typeorm";
import dayjs, {Dayjs} from "dayjs";
import {RandomIdBaseEntity} from "./RandomIdBaseEntity";

export abstract class TimeAwareRandomBaseEntity extends RandomIdBaseEntity {

    @Column({ type: 'datetime', nullable: false, readonly: true })
    createdAt: Dayjs = dayjs();

    @AfterLoad()
    convertToDomain() {
       if(this.createdAt !== undefined) {
           this.createdAt = dayjs(this.createdAt);
       }
    }

    @BeforeInsert()
    public convertToDatabase() {
        if(dayjs.isDayjs(this.createdAt)) {
            // @ts-ignore
            this.createdAt = this.createdAt.toDate();
        }
    }
}
