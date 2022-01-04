import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, PrimaryColumn, OneToMany, OneToOne} from "typeorm";
import {Author} from "./Author";
import {ActionedEvent} from "./ActionedEvent";
import {Subreddit} from "./Subreddit";

@Entity()
export class Activity {

    @PrimaryColumn()
    id!: string;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert']})
    subreddit!: Subreddit;

    @Column("text")
    title!: string;

    @Column("text")
    permalink!: string;

    @ManyToOne(type => Author, author => author.activities, {cascade: ['insert']})
    author!: Author;

    @OneToMany(type => ActionedEvent, act => act.activity) // note: we will create author property in the Photo class below
    actionedEvents!: ActionedEvent[]
}
