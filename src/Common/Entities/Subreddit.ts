import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, PrimaryColumn, OneToMany, OneToOne} from "typeorm";
import {Author} from "./Author";
import {ActionedEvent} from "./ActionedEvent";
import {Activity} from "./Activity";

@Entity()
export class Subreddit {

    @PrimaryColumn()
    id!: string;

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => Activity, act => act.subreddit) // note: we will create author property in the Photo class below
    activities!: Activity[]
}
