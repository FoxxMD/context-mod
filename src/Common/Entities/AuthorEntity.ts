import {Entity, Column, PrimaryColumn, OneToMany} from "typeorm";
import {Activity} from "./Activity";
import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import {SnoowrapActivity} from "../Infrastructure/Reddit";
import {RedditUser} from "snoowrap/dist/objects";

@Entity({name: 'Author'})
export class AuthorEntity {

    @Column("varchar", {length: 20, nullable: true})
    id?: string;

    @PrimaryColumn("varchar", {length: 200})
    name!: string;

    @OneToMany(type => Activity, act => act.author)
    activities!: Promise<Activity[]>

    constructor(data?: any) {
        if(data !== undefined) {
            this.name = data.name;
        }
    }

    toSnoowrap(client: ExtendedSnoowrap): RedditUser {
        return new RedditUser({name: this.name, id: this.id}, client, false);
    }
}
