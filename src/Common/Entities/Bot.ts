import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {ManagerEntity} from "./ManagerEntity";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {BotGuestEntity, ManagerGuestEntity} from "./Guest/GuestEntity";
import {Guest, GuestEntityData, HasGuests} from "./Guest/GuestInterfaces";
import {SubredditInvite} from "./SubredditInvite";

@Entity()
export class Bot extends RandomIdBaseEntity implements HasGuests {

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => ManagerEntity, obj => obj.bot)
    managers!: Promise<ManagerEntity[]>

    @OneToMany(type => BotGuestEntity, obj => obj.guestOf, {eager: true, cascade: ['insert', 'remove', 'update']})
    guests!: BotGuestEntity[]

    @OneToMany(type => SubredditInvite, obj => obj.bot, {eager: true, cascade: ['insert', 'remove', 'update']})
    subredditInvites!: SubredditInvite[]

    getGuests() {
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
                guests.push(new BotGuestEntity({...g, guestOf: this}));
            }
        }
        this.guests = guests
        return guests;
    }

    removeGuestById(val: string | string[]) {
        const reqGuests = Array.isArray(val) ? val : [val];
        const guests = this.guests;
        const filteredGuests = guests.filter(x => reqGuests.includes(x.id));
        this.guests = filteredGuests;
        return filteredGuests;
    }

    removeGuestByUser(val: string | string[]) {
        const reqGuests = (Array.isArray(val) ? val : [val]).map(x => x.trim().toLowerCase());
        const guests = this.guests;
        const filteredGuests = guests.filter(x => reqGuests.includes(x.author.name.toLowerCase()));
        this.guests =filteredGuests;
        return filteredGuests;
    }

    removeGuests() {
        this.guests = []
        return [];
    }

    getSubredditInvites(): SubredditInvite[] {
        if(this.subredditInvites === undefined) {
            return [];
        }
        return this.subredditInvites;
    }

    addSubredditInvite(invite: SubredditInvite) {
        if(this.subredditInvites === undefined) {
            this.subredditInvites = [];
        }
        this.subredditInvites.push(invite);
    }

    removeSubredditInvite(invite: SubredditInvite) {
        if(this.subredditInvites === undefined) {
            return;
        }
        const index = this.subredditInvites.findIndex(x => x.id === invite.id);
        this.subredditInvites.splice(index, 1);
    }
}
