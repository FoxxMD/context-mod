import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, PrimaryColumn, OneToMany, OneToOne} from "typeorm";
import {AuthorEntity} from "./AuthorEntity";
import {Subreddit} from "./Subreddit";
import {CMEvent} from "./CMEvent";
import {ActivityType} from "../interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import {Comment} from "snoowrap";
import {asComment} from "../../util";

export interface ActivityEntityOptions {
    id: string
    subreddit: Subreddit
    type: ActivityType
    title: string
    permalink: string
    author: AuthorEntity
    submission?: Activity
}

@Entity()
export class Activity {

    @PrimaryColumn()
    id!: string;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert']})
    subreddit!: Subreddit;

    @Column("varchar", {length: 20})
    type!: ActivityType

    @Column("text")
    title!: string;

    @Column("text")
    permalink!: string;

    @ManyToOne(type => AuthorEntity, author => author.activities, {cascade: ['insert']})
    author!: AuthorEntity;

    @OneToMany(type => CMEvent, act => act.activity) // note: we will create author property in the Photo class below
    actionedEvents!: CMEvent[]

    @ManyToOne(type => Activity, obj => obj.comments, {nullable: true})
    submission?: Activity;

    @OneToMany(type => Activity, obj => obj.submission, {nullable: true})
    comments!: Activity[];

    constructor(data?: ActivityEntityOptions) {
        if(data !== undefined) {
            this.id = data.id;
            this.subreddit = data.subreddit;
            this.type = data.type;
            this.title = data.title;
            this.permalink = data.permalink;
            this.author = data.author;
            this.submission = data.submission;
        }
    }

    static fromSnoowrapActivity(subreddit: Subreddit, activity: (Submission | Comment)) {
        let submission: Activity | undefined;
        let type: ActivityType = 'submission';
        let content: string;
        if(asComment(activity)) {
            type = 'comment';
            content = activity.body;
            submission = new Activity();
            submission.type = 'submission';
            submission.id = activity.link_id;
            submission.subreddit = subreddit;
        } else {
            content = activity.title;
        }

        const author = new AuthorEntity();
        author.name = activity.author.name;

        return new Activity({
            id: activity.id,
            subreddit,
            type,
            title: content,
            permalink: activity.permalink,
            author,
            submission
        })
    }
}
