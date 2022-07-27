import {Entity, Column, PrimaryColumn, OneToMany} from "typeorm";
import {Activity} from "./Activity";

@Entity({name: 'Author'})
export class AuthorEntity {

    @Column("varchar", {length: 20, nullable: true})
    id?: string;

    @PrimaryColumn("varchar", {length: 200})
    name!: string;

    @OneToMany(type => Activity, act => act.author)
    activities!: Activity[]

    constructor(data?: any) {
        if(data !== undefined) {
            this.name = data.name;
        }
    }
}
