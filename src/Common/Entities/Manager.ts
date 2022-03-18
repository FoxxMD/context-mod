import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {Activity} from "./Activity";
import {Subreddit} from "./Subreddit";
import {RuleResult} from "./RuleResult";
import {CMEvent} from "./CMEvent";
import {Rule} from "./Rule";
import {Action} from "./Action";
import {Check} from "./Check";
import {Run} from "./Run";
import {Bot} from "./Bot";

export interface ManagerEntityOptions {
    name: string
    bot: Bot
    subreddit: Subreddit
}

@Entity()
export class Manager {

    @PrimaryGeneratedColumn()
    id!: string;

    @Column("varchar", {length: 200})
    name!: string;

    @ManyToOne(type => Bot, sub => sub.managers, {cascade: ['insert'], eager: true})
    bot!: Bot;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert'], eager: true})
    subreddit!: Subreddit;

    @OneToMany(type => CMEvent, obj => obj.manager)
    events!: Promise<CMEvent[]>

    @OneToMany(type => Rule, obj => obj.manager)
    rules!: Promise<Rule[]>

    @OneToMany(type => Action, obj => obj.manager)
    actions!: Promise<Action[]>

    @OneToMany(type => Check, obj => obj.manager) // note: we will create author property in the Photo class below
    checks!: Promise<Check[]>

    @OneToMany(type => Run, obj => obj.manager) // note: we will create author property in the Photo class below
    runs!: Promise<Run[]>

    constructor(data?: ManagerEntityOptions) {
        if (data !== undefined) {
            this.name = data.name;
            this.bot = data.bot;
            this.subreddit = data.subreddit;
        }
    }
}
