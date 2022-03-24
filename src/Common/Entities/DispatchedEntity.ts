import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    ManyToOne,
    PrimaryColumn,
    BeforeInsert,
    AfterLoad
} from "typeorm";
import {
    ActivityDispatch,
    ActivitySourceTypes,
    DurationVal,
    NonDispatchActivitySource,
    onExistingFoundBehavior
} from "../interfaces";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {Duration} from "dayjs/plugin/duration";
import dayjs from "dayjs";
import {ManagerEntity} from "./ManagerEntity";
import {parseDuration, parseDurationValToDuration, parseRedditFullname} from "../../util";
import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";

@Entity({name: 'DispatchedAction'})
export class DispatchedEntity extends TimeAwareRandomBaseEntity {

    @Column()
    activityId!: string

    @Column({type: 'int', width: 13, nullable: false, readonly: true, unsigned: true})
    delay!: number

    @Column({nullable: true})
    action?: string

    @Column({nullable: true, length: 200})
    goto?: string

    @Column()
    type!: ActivitySourceTypes

    @Column({nullable: true, length: 200})
    identifier?: string

    @Column("varchar", {nullable: true, length: 200})
    cancelIfQueued?: boolean | NonDispatchActivitySource | NonDispatchActivitySource[]

    @Column({nullable: true})
    onExistingFound?: onExistingFoundBehavior

    @ManyToOne(type => ManagerEntity, act => act.events)
    manager!: ManagerEntity;

    @Column("varchar", {length: 200})
    tardyTolerant!: boolean | number

    constructor(data?: ActivityDispatch & { manager: ManagerEntity }) {
        super();
        if (data !== undefined) {
            this.activityId = data.activity.name;
            this.delay = data.delay;
            this.type = data.type;
            this.action = data.action;
            this.goto = data.goto;
            this.identifier = data.identifier;
            this.cancelIfQueued = data.cancelIfQueued;
            this.onExistingFound = data.onExistingFound;
            this.manager = data.manager;
            if (data.tardyTolerant === undefined) {
                this.tardyTolerant = dayjs.duration(5, 'minutes').asMilliseconds();
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
        if (typeof this.tardyTolerant === 'boolean') {
            // @ts-ignore
            this.tardyTolerant = this.tardyTolerant ? 'true' : 'false';
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
                this.cancelIfQueued = JSON.parse(cVal) as NonDispatchActivitySource[];
            }
        }

        // @ts-ignore
        const tVal = this.tardyTolerant as string;
        if (tVal === 'true' || tVal === 'false') {
            this.tardyTolerant = tVal === 'true';
        } else {
            this.tardyTolerant = Number.parseInt(tVal);
        }
    }

    async toActivityDispatch(client: ExtendedSnoowrap): Promise<ActivityDispatch> {
        const redditThing = parseRedditFullname(this.activityId);
        let activity: Comment | Submission;
        if (redditThing?.type === 'comment') {
            // @ts-ignore
            activity = await client.getComment(redditThing.id);
        } else {
            // @ts-ignore
            activity = await client.getSubmission(redditThing.id);
        }
        return {
            id: this.id,
            queuedAt: this.createdAt.unix(),
            activity,
            delay: this.delay,
            processing: false,
            action: this.action,
            goto: this.goto,
            onExistingFound: this.onExistingFound,
            cancelIfQueued: this.cancelIfQueued,
            identifier: this.identifier,
            type: this.type,
        }
    }

    delayAsDuration() {
        return dayjs.duration(this.delay, 'millisecond');
    }

    tardyTolerantAsDuration() {
        return dayjs.duration(this.tardyTolerant as number, 'millisecond');
    }
}
