import {ChildEntity, Column, Entity, JoinColumn, ManyToOne, TableInheritance} from "typeorm";
import {AuthorEntity} from "../AuthorEntity";
import { ManagerEntity } from "../ManagerEntity";
import { Bot } from "../Bot";
import {TimeAwareRandomBaseEntity} from "../Base/TimeAwareRandomBaseEntity";
import dayjs, {Dayjs} from "dayjs";
import {Guest, GuestAll, GuestEntityData} from "./GuestInterfaces";

export interface GuestOptions<T extends ManagerEntity | Bot> extends GuestEntityData {
    guestOf: T
}

@Entity({name: 'Guests'})
@TableInheritance({ column: { type: "varchar", name: "type" } })
export abstract class GuestEntity<T extends ManagerEntity | Bot> extends TimeAwareRandomBaseEntity {

    @ManyToOne(type => AuthorEntity, undefined, {cascade: ['insert'], eager: true})
    @JoinColumn({name: 'authorName'})
    author!: AuthorEntity;

    @Column({ name: 'expiresAt', nullable: true })
    _expiresAt?: Date = new Date();

    public get expiresAt(): Dayjs {
        return dayjs(this._expiresAt);
    }

    public set expiresAt(d: Dayjs | undefined) {
        if(d === undefined) {
            this._expiresAt = d;
        } else {
            this._expiresAt = d.utc().toDate();
        }
    }

    expiresAtTimestamp(): number | undefined {
        if(this._expiresAt !== undefined) {
           return this.expiresAt.valueOf();
        }
        return undefined;
    }

    protected constructor(data?: GuestOptions<T>) {
        super();
        if(data !== undefined) {
            this.author = data.author;
            this.expiresAt = data.expiresAt;
        }
    }
}

@ChildEntity('manager')
export class ManagerGuestEntity extends GuestEntity<ManagerEntity> {

    type: string = 'manager';

    @ManyToOne(type => ManagerEntity, act => act.guests, {nullable: false, orphanedRowAction: 'delete'})
    @JoinColumn({name: 'guestOfId', referencedColumnName: 'id'})
    guestOf!: ManagerEntity

    constructor(data?: GuestOptions<ManagerEntity>) {
        super(data);
        if(data !== undefined) {
            this.guestOf = data.guestOf;
        }
    }
}

@ChildEntity('bot')
export class BotGuestEntity extends GuestEntity<Bot> {

    type: string = 'bot';

    @ManyToOne(type => Bot, act => act.guests, {nullable: false, orphanedRowAction: 'delete'})
    @JoinColumn({name: 'guestOfId', referencedColumnName: 'id'})
    guestOf!: Bot

    constructor(data?: GuestOptions<Bot>) {
        super(data);
        if(data !== undefined) {
            this.guestOf = data.guestOf;
            this.author = data.author;
        }
    }
}

export const guestEntityToApiGuest = (val: GuestEntity<any>): Guest => {
    return {
        id: val.id,
        name: val.author.name,
        expiresAt: val.expiresAtTimestamp(),
    }
}

interface ContextualGuest extends Guest {
    subreddit: string
}

export const guestEntitiesToAll = (val: Map<string, Guest[]>): GuestAll[] => {
    const contextualGuests: ContextualGuest[] = Array.from(val.entries()).map(([sub, guests]) => guests.map(y => ({...y, subreddit: sub} as ContextualGuest))).flat(3);

    const userMap = contextualGuests.reduce((acc, curr) => {
        let u: GuestAll | undefined = acc.get(curr.name);
        if (u === undefined) {
            u = {name: curr.name, expiresAt: curr.expiresAt, subreddits: [curr.subreddit]};
        } else {
            if (!u.subreddits.includes(curr.subreddit)) {
                u.subreddits.push(curr.subreddit);
            }
            if ((u.expiresAt === undefined && curr.expiresAt !== undefined) || (u.expiresAt !== undefined && curr.expiresAt !== undefined && curr.expiresAt < u.expiresAt)) {
                u.expiresAt = curr.expiresAt;
            }
        }
        acc.set(curr.name, u);
        return acc;
    }, new Map<string, GuestAll>());

    return Array.from(userMap.values());
}
