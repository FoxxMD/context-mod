import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    AfterLoad,
    BeforeInsert,
    Index
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

    @Index()
    @Column({ type: 'datetime', nullable: false, readonly: true })
    queuedAt: Dayjs = dayjs();

    @Index()
    @Column({ type: 'datetime', nullable: false, readonly: true })
    processedAt: Dayjs = dayjs();

    @AfterLoad()
    convertToDomain() {
        this.processedAt = dayjs(this.queuedAt)
        this.queuedAt = dayjs(this.queuedAt)
    }

    @BeforeInsert()
    public convertToDatabase() {
        if(dayjs.isDayjs(this.processedAt)) {
            // @ts-ignore
            this.processedAt = this.processedAt.toDate();
        }
        if(dayjs.isDayjs(this.queuedAt)) {
            // @ts-ignore
            this.queuedAt = this.queuedAt.toDate();
        }
    }

    @AfterLoad()
    sortRuns() {
        this.runResults.sort((a, b) => a.createdAt.isSameOrBefore(b.createdAt) ?  -1 : 1);
    }
}
