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
import {getActivityAuthorName, parseDuration, parseDurationValToDuration, parseRedditFullname} from "../../util";
import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {ColumnDurationTransformer} from "./Transformers";
import { RedditUser } from "snoowrap/dist/objects";

@Entity({name: 'DispatchedAction'})
export class DispatchedEntity extends TimeAwareRandomBaseEntity {

    @Column()
    activityId!: string

    @Column()
    author!: string

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
    cancelIfQueued?: boolean | NonDispatchActivitySource | NonDispatchActivitySource[]

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

    constructor(data?: ActivityDispatch & { manager: ManagerEntity }) {
        super();
        if (data !== undefined) {
            this.activityId = data.activity.name;
            this.author = getActivityAuthorName(data.activity.author);
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
                this.cancelIfQueued = JSON.parse(cVal) as NonDispatchActivitySource[];
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
        const redditThing = parseRedditFullname(this.activityId);
        let activity: Comment | Submission;
        if (redditThing?.type === 'comment') {
            // @ts-ignore
            activity = await client.getComment(redditThing.id);
        } else {
            // @ts-ignore
            activity = await client.getSubmission(redditThing.id);
        }
        activity.author = new RedditUser({name: this.author}, client, false);
        return {
            id: this.id,
            queuedAt: this.createdAt,
            activity,
            delay: this.delay,
            processing: false,
            action: this.action,
            goto: this.goto,
            onExistingFound: this.onExistingFound,
            cancelIfQueued: this.cancelIfQueued,
            identifier: this.identifier,
            type: this.type,
            author: this.author,
            dryRun: this.dryRun
        }
    }
}
