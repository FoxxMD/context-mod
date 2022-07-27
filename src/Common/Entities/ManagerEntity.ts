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
import {QueueRunState} from "./EntityRunState/QueueRunState";
import {EventsRunState} from "./EntityRunState/EventsRunState";
import {RulePremise} from "./RulePremise";
import {ActionPremise} from "./ActionPremise";
import {RunningStateTypes} from "../../Subreddit/Manager";
import {EntityRunState} from "./EntityRunState/EntityRunState";
import {GuestEntity, ManagerGuestEntity} from "./Guest/GuestEntity";
import {Guest, GuestEntityData, HasGuests} from "./Guest/GuestInterfaces";

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
export class ManagerEntity extends RandomIdBaseEntity implements RunningStateEntities, HasGuests {

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

    @OneToMany(type => CheckEntity, obj => obj.manager)
    checks!: Promise<CheckEntity[]>

    @OneToMany(type => RunEntity, obj => obj.manager)
    runs!: Promise<RunEntity[]>

    @OneToMany(type => ManagerGuestEntity, obj => obj.guestOf, {eager: true, cascade: ['insert', 'remove', 'update']})
    guests!: ManagerGuestEntity[]

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

    getGuests(): ManagerGuestEntity[] {
        const g = this.guests;
        if (g === undefined) {
            return [];
        }
        //return g.map(x => ({id: x.id, name: x.author.name, expiresAt: x.expiresAt})) as Guest[];
        return g;
    }

   addGuest(val: GuestEntityData | GuestEntityData[]) {
        const reqGuests = Array.isArray(val) ? val : [val];
        const guests = this.guests;
        for (const g of reqGuests) {
            const existing = guests.find(x => x.author.name.toLowerCase() === g.author.name.toLowerCase());
            if (existing !== undefined) {
                // update existing guest expiresAt
                existing.expiresAt = g.expiresAt;
            } else {
                guests.push(new ManagerGuestEntity({...g, guestOf: this}));
            }
        }
        this.guests = guests;
        return guests;
    }

    removeGuestById(val: string | string[]) {
        const reqGuests = Array.isArray(val) ? val : [val];
        const guests = this.guests;
        const filteredGuests = guests.filter(x => !reqGuests.includes(x.id));
        this.guests = filteredGuests
        return filteredGuests;
    }

    removeGuestByUser(val: string | string[]) {
        const reqGuests = (Array.isArray(val) ? val : [val]).map(x => x.trim().toLowerCase());
        const guests = this.guests;
        const filteredGuests = guests.filter(x => !reqGuests.includes(x.author.name.toLowerCase()));
        this.guests = filteredGuests;
        return filteredGuests;
    }

    removeGuests() {
        this.guests = [];
        return [];
    }
}
