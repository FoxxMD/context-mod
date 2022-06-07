import {Entity, PrimaryColumn, Column, PrimaryGeneratedColumn} from "typeorm";
import {ActionTypes} from "../Infrastructure/Atomic";

@Entity()
export class ActionType  {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 200})
    name!: string

    constructor(name?: string) {
        if(name !== undefined) {
            this.name = name;
        }
    }
}
