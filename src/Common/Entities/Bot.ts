import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Activity} from "./Activity";
import {Action} from "./Action";
import {Manager} from "./Manager";

@Entity()
export class Bot {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => Manager, obj => obj.bot)
    managers!: Promise<Manager[]>
}
