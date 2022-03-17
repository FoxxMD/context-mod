import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, ManyToOne} from "typeorm";
import {Activity} from "./Activity";
import {Subreddit} from "./Subreddit";
import {RuleResult} from "./RuleResult";
import {CMEvent} from "./CMEvent";
import {Rule} from "./Rule";
import {Action} from "./Action";
import {Check} from "./Check";
import {Run} from "./Run";

@Entity()
export class Manager {

    @PrimaryGeneratedColumn()
    id!: string;

    @Column("varchar", {length: 200})
    name!: string;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert']})
    subreddit!: Subreddit;

    @OneToMany(type => CMEvent, obj => obj.manager)
    events!: CMEvent[]

    @OneToMany(type => Rule, obj => obj.manager)
    rules!: Rule[]

    @OneToMany(type => Action, obj => obj.manager)
    actions!: Action[]

    @OneToMany(type => Check, obj => obj.manager) // note: we will create author property in the Photo class below
    checks!: Check[]

    @OneToMany(type => Run, obj => obj.manager) // note: we will create author property in the Photo class below
    runs!: Run[]
}
