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
    @Column({ name: 'queuedAt', nullable: false })
    _queuedAt: Date = new Date();

    public get queuedAt(): Dayjs {
        return dayjs(this._queuedAt);
    }

    public set queuedAt(d: Dayjs) {
        this._queuedAt = d.utc().toDate();
    }

    @Index()
    @Column({ name: 'processedAt', nullable: false })
    _processedAt: Date = new Date();

    public get processedAt(): Dayjs {
        return dayjs(this._processedAt);
    }

    public set processedAt(d: Dayjs) {
        this._processedAt = d.utc().toDate();
    }

    @AfterLoad()
    sortRuns() {
        if(this.runResults !== undefined) {
            this.runResults.sort((a, b) => a.createdAt.isSameOrBefore(b.createdAt) ?  -1 : 1);
        }
    }
}
