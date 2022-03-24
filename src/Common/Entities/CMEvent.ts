import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    AfterLoad,
    BeforeInsert
} from "typeorm";
import {Activity} from "./Activity";
import {ManagerEntity} from "./ManagerEntity";
import {RunResultEntity} from "./RunResultEntity";
import {ActivitySourceEntity} from "./ActivitySourceEntity";
import dayjs, {Dayjs} from "dayjs";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";

@Entity()
export class CMEvent extends RandomIdBaseEntity {

    @Column("boolean")
    triggered!: boolean;

    @ManyToOne(type => ManagerEntity, act => act.events)
    manager!: ManagerEntity;

    @ManyToOne(type => Activity, act => act.actionedEvents, {cascade: ['insert', 'update']})
    activity!: Activity;

    @OneToMany(type => RunResultEntity, obj => obj.event, {cascade: ['insert']})
    runResults!: RunResultEntity[]

    @ManyToOne(type => ActivitySourceEntity, act => act.events, {cascade: ['insert'], eager: true})
    source!: ActivitySourceEntity;

    @Column({ type: 'int', width: 13, nullable: false, readonly: true, unsigned: true })
    queuedAt: Dayjs = dayjs();

    @Column({ type: 'int', width: 13, nullable: false, readonly: true, unsigned: true })
    processedAt: Dayjs = dayjs();

    @AfterLoad()
    convertToDayjs() {
        this.processedAt = dayjs(this.queuedAt)
        this.queuedAt = dayjs(this.queuedAt)
    }

    @BeforeInsert()
    public convertToUnix() {
        // @ts-ignore
        this.processedAt = this.processedAt.valueOf();
        // @ts-ignore
        this.queuedAt = this.queuedAt.valueOf();
    }

    @AfterLoad()
    sortRuns() {
        this.runResults.sort((a, b) => a.createdAt.isSameOrBefore(b.createdAt) ?  -1 : 1);
    }
}
