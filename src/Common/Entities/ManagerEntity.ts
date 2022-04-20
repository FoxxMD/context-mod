import {
    Entity,
    Column,
    PrimaryColumn,
    OneToMany,
    PrimaryGeneratedColumn,
    ManyToOne,
    OneToOne,
    JoinColumn
} from "typeorm";
import {Subreddit} from "./Subreddit";
import {CMEvent} from "./CMEvent";
import {CheckEntity} from "./CheckEntity";
import {RunEntity} from "./RunEntity";
import {Bot} from "./Bot";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {ManagerRunState} from "./EntityRunState/ManagerRunState";
import { QueueRunState } from "./EntityRunState/QueueRunState";
import {EventsRunState} from "./EntityRunState/EventsRunState";
import {RulePremise} from "./RulePremise";
import {ActionPremise} from "./ActionPremise";
import { RunningStateTypes } from "../../Subreddit/Manager";
import {EntityRunState} from "./EntityRunState/EntityRunState";

export interface ManagerEntityOptions {
    name: string
    bot: Bot
    subreddit: Subreddit
    eventsState: EventsRunState
    queueState: QueueRunState
    managerState: ManagerRunState
}

export type RunningStateEntities = {
    [key in RunningStateTypes]: EntityRunState;
};

@Entity({name: 'Manager'})
export class ManagerEntity extends RandomIdBaseEntity implements RunningStateEntities {

    @Column("varchar", {length: 200})
    name!: string;

    @ManyToOne(type => Bot, sub => sub.managers, {cascade: ['insert'], eager: true})
    bot!: Bot;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert'], eager: true})
    subreddit!: Subreddit;

    @OneToMany(type => CMEvent, obj => obj.manager)
    events!: Promise<CMEvent[]>

    @OneToMany(type => RulePremise, obj => obj.manager)
    rules!: Promise<RulePremise[]>

    @OneToMany(type => ActionPremise, obj => obj.manager)
    actions!: Promise<ActionPremise[]>

    @OneToMany(type => CheckEntity, obj => obj.manager) // note: we will create author property in the Photo class below
    checks!: Promise<CheckEntity[]>

    @OneToMany(type => RunEntity, obj => obj.manager) // note: we will create author property in the Photo class below
    runs!: Promise<RunEntity[]>

    @OneToOne(() => EventsRunState, {cascade: ['insert', 'update'], eager: true})
    @JoinColumn()
    eventsState!: EventsRunState

    @OneToOne(() => QueueRunState, {cascade: ['insert', 'update'], eager: true})
    @JoinColumn()
    queueState!: QueueRunState

    @OneToOne(() => ManagerRunState, {cascade: ['insert', 'update'], eager: true})
    @JoinColumn()
    managerState!: ManagerRunState

    constructor(data?: ManagerEntityOptions) {
        super();
        if (data !== undefined) {
            this.name = data.name;
            this.bot = data.bot;
            this.subreddit = data.subreddit;
            this.eventsState = data.eventsState;
            this.queueState = data.queueState;
            this.managerState = data.managerState;
        }
    }
}
