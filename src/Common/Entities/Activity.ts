import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, PrimaryColumn, OneToMany, OneToOne} from "typeorm";
import {Author} from "./Author";
import {Subreddit} from "./Subreddit";
import {CMEvent} from "./CMEvent";

@Entity()
export class Activity {

    @PrimaryColumn()
    id!: string;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert']})
    subreddit!: Subreddit;

    @Column("varchar", {length: 20})
    type!: 'submission' | 'comment'

    @Column("text")
    title!: string;

    @Column("text")
    permalink!: string;

    @ManyToOne(type => Author, author => author.activities, {cascade: ['insert']})
    author!: Author;

    @OneToMany(type => CMEvent, act => act.activity) // note: we will create author property in the Photo class below
    actionedEvents!: CMEvent[]

    @ManyToOne(type => Activity, obj => obj.comments, {nullable: true})
    submission!: Activity;

    @OneToMany(type => Activity, obj => obj.submission)
    comments!: Activity[];
}
