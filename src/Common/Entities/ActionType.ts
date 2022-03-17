import {Entity, PrimaryColumn, Column, PrimaryGeneratedColumn} from "typeorm";
import {ActionTypes} from "../types";

@Entity()
export class ActionType  {

    @PrimaryGeneratedColumn()
    id!: string;

    @Column("varchar", {length: 200})
    name!: ActionTypes
}
