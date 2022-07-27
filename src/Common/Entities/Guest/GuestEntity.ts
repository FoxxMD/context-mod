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

@ChildEntity()
export class ManagerGuestEntity extends GuestEntity<ManagerEntity> {

    type: string = 'manager';

    @ManyToOne(type => ManagerEntity, act => act.guests, {eager: true})
    @JoinColumn({name: 'guestOfId'})
    guestOf!: ManagerEntity

    constructor(data?: GuestOptions<ManagerEntity>) {
        super();
        if(data !== undefined) {
            this.guestOf = data.guestOf;
        }
    }
}

@ChildEntity()
export class BotGuestEntity extends GuestEntity<Bot> {

    type: string = 'bot';

    @ManyToOne(type => Bot, act => act.guests, {eager: true})
    @JoinColumn({name: 'guestOfId'})
    guestOf!: Bot

    constructor(data?: GuestOptions<Bot>) {
        super();
        if(data !== undefined) {
            this.guestOf = data.guestOf;
        }
    }
}

export const guestEntityToApiGuest = (val: GuestEntity<any>): Guest => {
    return {
        id: val.id,
        name: val.author.name,
        expiresAt: val.expiresAtTimestamp()
    }
}

export const guestEntitiesToAll = (val: ManagerGuestEntity[]): GuestAll[] => {
    const userMap = val.reduce((acc, curr) => {
        let u: GuestAll | undefined = acc.get(curr.author.name);
        if (u === undefined) {
            u = {name: curr.author.name, expiresAt: curr.expiresAtTimestamp(), subreddits: [curr.guestOf.name]};
        } else {
            if (!u.subreddits.includes(curr.guestOf.name)) {
                u.subreddits.push(curr.guestOf.name);
            }
            if ((u.expiresAt === undefined && curr.expiresAt !== undefined) || (u.expiresAt !== undefined && curr.expiresAt !== undefined && curr.expiresAt.isBefore(u.expiresAt))) {
                u.expiresAt = curr.expiresAtTimestamp();
            }
        }
        acc.set(curr.author.name, u);
        return acc;
    }, new Map<string, GuestAll>());

    return Array.from(userMap.values());
}
