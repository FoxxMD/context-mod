import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {Activity} from "./Activity";
import {Subreddit} from "./Subreddit";
import {RuleResultEntity} from "./RuleResultEntity";
import {CMEvent} from "./CMEvent";
import {Rule} from "./Rule";
import {Action} from "./Action";
import {CheckEntity} from "./CheckEntity";
import {RunEntity} from "./RunEntity";
import {Bot} from "./Bot";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";

export interface ManagerEntityOptions {
    name: string
    bot: Bot
    subreddit: Subreddit
}

@Entity({name: 'Manager'})
export class ManagerEntity extends RandomIdBaseEntity {

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

    @OneToMany(type => CheckEntity, obj => obj.manager) // note: we will create author property in the Photo class below
    checks!: Promise<CheckEntity[]>

    @OneToMany(type => RunEntity, obj => obj.manager) // note: we will create author property in the Photo class below
    runs!: Promise<RunEntity[]>

    constructor(data?: ManagerEntityOptions) {
        super();
        if (data !== undefined) {
            this.name = data.name;
            this.bot = data.bot;
            this.subreddit = data.subreddit;
        }
    }
}
