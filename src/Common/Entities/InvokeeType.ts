import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Activity} from "./Activity";
import {Invokee} from "../interfaces";

@Entity()
export class InvokeeType {

    @PrimaryGeneratedColumn()
    id?: number;

    @Column("varchar", {length: 50})
    name!: Invokee;

    constructor(name?: Invokee) {
        if(name !== undefined) {
            this.name = name;
        }
    }
}