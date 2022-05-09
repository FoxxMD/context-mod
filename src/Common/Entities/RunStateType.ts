import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Activity} from "./Activity";
import {RunState} from "../Typings/Atomic";

@Entity()
export class RunStateType {

    @PrimaryGeneratedColumn()
    id?: number;

    @Column("varchar", {length: 50})
    name!: RunState;

    constructor(name?: RunState) {
        if(name !== undefined) {
            this.name = name;
        }
    }
}
