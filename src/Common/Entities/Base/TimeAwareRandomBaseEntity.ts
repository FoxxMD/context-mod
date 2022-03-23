import {BeforeInsert, Entity, Column, AfterLoad} from "typeorm";
import dayjs, {Dayjs} from "dayjs";
import {RandomIdBaseEntity} from "./RandomIdBaseEntity";

export abstract class TimeAwareRandomBaseEntity extends RandomIdBaseEntity {

    @Column({ type: 'int', width: 13, nullable: false, readonly: true, unsigned: true })
    createdAt: Dayjs = dayjs();

    @AfterLoad()
    convertToDayjs() {
       if(this.createdAt !== undefined) {
           this.createdAt = dayjs(this.createdAt);
       }
    }

    @BeforeInsert()
    public convertToUnix() {
        // @ts-ignore
        this.createdAt = this.createdAt.valueOf();
    }
}
