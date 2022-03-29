import {BeforeInsert, Entity, Column, AfterLoad, BeforeUpdate} from "typeorm";
import dayjs, {Dayjs} from "dayjs";

export abstract class TimeAwareBaseEntity {

    @Column({ type: 'datetime', nullable: false })
    createdAt: Dayjs = dayjs();

    @AfterLoad()
    convertToDomain() {
       if(this.createdAt !== undefined) {
           this.createdAt = dayjs(this.createdAt);
       }
    }

    @BeforeInsert()
    @BeforeUpdate()
    public convertToDatabase() {
        if(dayjs.isDayjs(this.createdAt)) {
            // @ts-ignore
            this.createdAt = this.createdAt.toDate();
        }
    }
}
