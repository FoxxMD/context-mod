import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    ManyToOne,
    PrimaryColumn,
    BeforeInsert,
    AfterLoad, JoinColumn
} from "typeorm";
import {
    ActivityDispatch
} from "../interfaces";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {Duration} from "dayjs/plugin/duration";
import dayjs from "dayjs";
import {ManagerEntity} from "./ManagerEntity";
import {getActivityAuthorName, parseDuration, parseDurationValToDuration, parseRedditFullname} from "../../util";
import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {ColumnDurationTransformer} from "./Transformers";
import { RedditUser } from "snoowrap/dist/objects";
import {ActivitySourceTypes, DurationVal, NonDispatchActivitySourceValue, onExistingFoundBehavior} from "../Infrastructure/Atomic";
import {Activity} from "./Activity";

@Entity({name: 'DispatchedAction'})
export class DispatchedEntity extends TimeAwareRandomBaseEntity {

    //@ManyToOne(type => Activity, obj => obj.dispatched, {cascade: ['insert'], eager: true, nullable: false})
    @ManyToOne(type => Activity, undefined, {cascade: ['insert'], eager: true, nullable: false})
    @JoinColumn({name: 'activityId'})
    activity!: Activity

    @Column({
        type: 'int',
        nullable: false,
        unsigned: true,
        transformer: new ColumnDurationTransformer()
    })
    delay!: Duration

    @Column({nullable: true})
    action?: string

    @Column({nullable: true, length: 200})
    goto?: string

    @Column()
    type!: ActivitySourceTypes

    @Column({nullable: true, length: 200})
    identifier?: string

    @Column("varchar", {nullable: true, length: 200})
    cancelIfQueued?: boolean | NonDispatchActivitySourceValue | NonDispatchActivitySourceValue[]

    @Column({nullable: true})
    onExistingFound?: onExistingFoundBehavior

    @Column("boolean", {nullable: true})
    dryRun?: boolean;

    @ManyToOne(type => ManagerEntity, act => act.events)
    manager!: ManagerEntity;

    @Column("varchar", {
        length: 200,
        transformer: {
            to: (val: boolean | Duration): string | undefined => {
                if(typeof val === 'boolean') {
                    return val ? 'true' : 'false';
                }
                return val.asSeconds().toString();
            },
            from: (val: string): boolean | Duration => {
                if(val === 'true' || val === 'false') {
                    return val === 'true';
                }
                return dayjs.duration(Number.parseInt(val), 'seconds');
            }
        }})
    tardyTolerant!: boolean | Duration

    constructor(data?: HydratedActivityDispatch) {
        super();
        if (data !== undefined) {
            this.activity = data.activity;
            this.delay = data.delay;
            this.createdAt = data.queuedAt;
            this.type = data.type;
            this.action = data.action;
            this.goto = data.goto;
            this.identifier = data.identifier;
            this.cancelIfQueued = data.cancelIfQueued;
            this.onExistingFound = data.onExistingFound;
            this.manager = data.manager;
            this.dryRun = data.dryRun;
            if (data.tardyTolerant === undefined) {
                this.tardyTolerant = dayjs.duration(5, 'minutes');
            } else {
                this.tardyTolerant = data.tardyTolerant;
            }
        }
    }

    @BeforeInsert()
    setPrimitives() {
        if (this.cancelIfQueued !== undefined) {
            if (typeof this.cancelIfQueued === 'boolean') {
                // @ts-ignore
                this.cancelIfQueued = this.cancelIfQueued ? 'true' : 'false';
            } else if (Array.isArray(this.cancelIfQueued)) {
                // @ts-ignore
                this.cancelIfQueued = JSON.stringify(this.cancelIfQueued);
            }
        }
    }

    @AfterLoad()
    convertPrimitives() {
        if (this.cancelIfQueued !== undefined) {
            const cVal = this.cancelIfQueued as string;
            if (cVal === 'true') {
                this.cancelIfQueued = true;
            } else if (cVal === 'false') {
                this.cancelIfQueued = false;
            } else if (cVal.includes('[')) {
                this.cancelIfQueued = JSON.parse(cVal) as NonDispatchActivitySourceValue[];
            }
        }
        if(this.goto === null) {
            this.goto = undefined;
        }
        if(this.action === null) {
            this.action = undefined;
        }
        if(this.identifier === null) {
            this.identifier = undefined;
        }
        if(this.cancelIfQueued === null) {
            this.cancelIfQueued = undefined;
        }
        if(this.onExistingFound === null) {
            this.onExistingFound = undefined;
        }
        if(this.dryRun === null) {
            this.dryRun = undefined;
        }
    }

    async toActivityDispatch(client: ExtendedSnoowrap): Promise<ActivityDispatch> {
        let activity = this.activity.toSnoowrap(client);
        return {
            id: this.id,
            queuedAt: this.createdAt,
            activity,
            delay: this.delay,
            action: this.action,
            goto: this.goto,
            onExistingFound: this.onExistingFound,
            cancelIfQueued: this.cancelIfQueued,
            identifier: this.identifier,
            type: this.type,
            author: activity.author.name,
            dryRun: this.dryRun
        }
    }
}

export interface HydratedActivityDispatch extends Omit<ActivityDispatch, 'activity'> {
    activity: Activity
    manager: ManagerEntity
}
