import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Activity} from "./Activity";
import {Action} from "./Action";
import {ManagerEntity} from "./ManagerEntity";

@Entity()
export class Bot {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => ManagerEntity, obj => obj.bot)
    managers!: Promise<ManagerEntity[]>
}
