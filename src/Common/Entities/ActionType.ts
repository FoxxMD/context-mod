import {Entity, PrimaryColumn, Column, PrimaryGeneratedColumn} from "typeorm";
import {ActionTypes} from "../types";

@Entity()
export class ActionType  {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 200})
    name!: ActionTypes

    constructor(name?: ActionTypes) {
        if(name !== undefined) {
            this.name = name;
        }
    }
}
