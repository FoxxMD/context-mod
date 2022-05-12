import {Entity, Column, PrimaryColumn, OneToMany, Index} from "typeorm";
import {Activity} from "./Activity";

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
}
