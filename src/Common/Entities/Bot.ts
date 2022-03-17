import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Activity} from "./Activity";

@Entity()
export class Bot {

    @PrimaryGeneratedColumn()
    id!: string;

    @Column("varchar", {length: 200})
    name!: string;
}
