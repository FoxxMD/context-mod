import {BeforeInsert, Entity, Column, AfterLoad, BeforeUpdate} from "typeorm";
import dayjs, {Dayjs} from "dayjs";
import {RandomIdBaseEntity} from "./RandomIdBaseEntity";

export abstract class TimeAwareBaseEntity {

    @Column({ type: 'bigint', width: 13, nullable: false, readonly: true, unsigned: true })
    createdAt: Dayjs = dayjs();

    @AfterLoad()
    convertToDayjs() {
       if(this.createdAt !== undefined) {
           this.createdAt = dayjs(this.createdAt);
       }
    }

    @BeforeInsert()
    @BeforeUpdate()
    public convertToUnix() {
        // @ts-ignore
        this.createdAt = this.createdAt.valueOf();
    }
}
