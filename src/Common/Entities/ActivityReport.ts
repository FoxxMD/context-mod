import {
    Entity,
    Column,
    ManyToOne, JoinColumn, AfterLoad,
} from "typeorm";
import {Activity} from "./Activity";
import {ManagerEntity} from "./ManagerEntity";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {Report, ReportType} from "../Infrastructure/Reddit";

@Entity()
export class ActivityReport extends TimeAwareRandomBaseEntity {

    @Column({nullable: false, length: 500})
    reason!: string

    @Column({nullable: false, length: 20})
    type!: ReportType

    @Column({nullable: true, length: 100})
    author?: string

    @Column("int", {nullable: false})
    granularity: number = 0;

    @ManyToOne(type => Activity, act => act.reports, {cascade: ['update']})
    @JoinColumn({name: 'activityId'})
    activity!: Activity;

    @Column({nullable: false, name: 'activityId'})
    activityId!: string

    constructor(data?: Report & { activity: Activity, granularity: number }) {
        super();
        if (data !== undefined) {
            this.reason = data.reason;
            this.type = data.type;
            this.author = data.author;
            this.activity = data.activity;
            this.activityId = data.activity.id;
            this.granularity = data.granularity
        }
    }

    matchReport(report: Report): boolean {
        return this.reason === report.reason
            && this.type === report.type
            && this.author === report.author;
    }

    @AfterLoad()
    convertPrimitives() {
        if(this.author === null) {
            this.author = undefined;
        }
    }
}
