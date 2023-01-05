import {Entity, Column, PrimaryColumn, OneToMany, Index, DataSource} from "typeorm";
import {Activity} from "./Activity";
import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import {Subreddit as SnoowrapSubreddit} from "snoowrap/dist/objects";

export interface SubredditEntityOptions {
    id: string
    name: string
}

@Entity()
export class Subreddit {

    @PrimaryColumn()
    id!: string;

    @Index({unique: true})
    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => Activity, act => act.subreddit) // note: we will create author property in the Photo class below
    activities!: Promise<Activity[]>

    constructor(data?: SubredditEntityOptions) {
        if (data !== undefined) {
            this.id = data.id;
            this.name = data.name;
        }
    }

    toSnoowrap(client: ExtendedSnoowrap): SnoowrapSubreddit {
        return new SnoowrapSubreddit({display_name: this.name, name: this.id}, client, false);
    }

    static async fromSnoowrap(subreddit: SnoowrapSubreddit, db?: DataSource) {
        if(db !== undefined) {
           const existing = await db.getRepository(Subreddit).findOneBy({name: subreddit.display_name});
           if(existing) {
               return existing;
           }
        }
        return new Subreddit({id: await subreddit.name, name: await subreddit.display_name});
    }
}
