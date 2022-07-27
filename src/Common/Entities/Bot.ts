import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {ManagerEntity} from "./ManagerEntity";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";
import {BotGuestEntity, ManagerGuestEntity} from "./Guest/GuestEntity";
import {Guest, GuestEntityData, HasGuests} from "./Guest/GuestInterfaces";

@Entity()
export class Bot extends RandomIdBaseEntity implements HasGuests {

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => ManagerEntity, obj => obj.bot)
    managers!: Promise<ManagerEntity[]>

    @OneToMany(type => BotGuestEntity, obj => obj.guestOf, {cascade: ['insert', 'remove', 'update']})
    guests!: Promise<BotGuestEntity[]>

    async getGuests() {
        const g = await this.guests;
        if (g === undefined) {
            return [];
        }
        //return g.map(x => ({id: x.id, name: x.author.name, expiresAt: x.expiresAt})) as Guest[];
        return g;
    }

    async addGuest(val: GuestEntityData | GuestEntityData[]) {
        const reqGuests = Array.isArray(val) ? val : [val];
        const guests = await this.guests;
        for (const g of reqGuests) {
            const existing = guests.find(x => x.author.name.toLowerCase() === g.author.name.toLowerCase());
            if (existing !== undefined) {
                // update existing guest expiresAt
                existing.expiresAt = g.expiresAt;
            } else {
                guests.push(new BotGuestEntity({...g, guestOf: this}));
            }
        }
        this.guests = Promise.resolve(guests);
        return guests;
    }

    async removeGuestById(val: string | string[]) {
        const reqGuests = Array.isArray(val) ? val : [val];
        const guests = await this.guests;
        const filteredGuests = guests.filter(x => reqGuests.includes(x.id));
        this.guests = Promise.resolve(filteredGuests);
        return filteredGuests;
    }

    async removeGuestByUser(val: string | string[]) {
        const reqGuests = (Array.isArray(val) ? val : [val]).map(x => x.trim().toLowerCase());
        const guests = await this.guests;
        const filteredGuests = guests.filter(x => reqGuests.includes(x.author.name.toLowerCase()));
        this.guests = Promise.resolve(filteredGuests);
        return filteredGuests;
    }

    async removeGuests() {
        this.guests = Promise.resolve([]);
        return [];
    }
}
