import {Entity, Column, PrimaryColumn, OneToMany} from "typeorm";
import {Activity} from "./Activity";

@Entity()
export class Author {

    @PrimaryColumn()
    id!: number;

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => Activity, act => act.author) // note: we will create author property in the Photo class below
    activities!: Activity[]
}
