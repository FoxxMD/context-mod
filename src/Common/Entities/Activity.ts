import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, PrimaryColumn, OneToMany, OneToOne, Index} from "typeorm";
import {AuthorEntity} from "./AuthorEntity";
import {Subreddit} from "./Subreddit";
import {CMEvent} from "./CMEvent";
import Submission from "snoowrap/dist/objects/Submission";
import {Comment} from "snoowrap";
import {asComment, getActivityAuthorName, parseRedditFullname, redditThingTypeToPrefix} from "../../util";
import {ActivityType} from "../Typings/Reddit";

export interface ActivityEntityOptions {
    id: string
    subreddit: Subreddit
    type: ActivityType
    content: string
    permalink: string
    author: AuthorEntity
    submission?: Activity
}

@Entity()
@Index(['name', 'type'], {unique: true})
export class Activity {

    @PrimaryColumn({name: 'id', comment: 'A reddit fullname -- includes prefix'})
    _id!: string;

    set id(data: string) {
        const thing = parseRedditFullname(data);
        if(thing !== undefined) {
            this._id = thing.val;
            this.type = thing.type as ActivityType
            this.name = thing.id;
        } else if(this.type !== undefined) {
            // assuming we accidentally used the non-prefixed id
            this._id = `${redditThingTypeToPrefix(this.type)}_${data}`;
            this.name = data;
        }
    }

    get id() {
        return this._id;
    }

    @Column({name: 'name'})
    name!: string;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert']})
    subreddit!: Subreddit;

    @Column("varchar", {length: 20})
    type!: ActivityType

    @Column("text")
    content!: string;

    @Index({unique: true})
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
            this.type = data.type;
            this.id = data.id;
            this.subreddit = data.subreddit;
            this.content = data.content;
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
        author.name = getActivityAuthorName(activity.author);

        return new Activity({
            id: activity.name,
            subreddit,
            type,
            content: content,
            permalink: activity.permalink,
            author,
            submission
        })
    }
}
