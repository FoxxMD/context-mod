import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Activity} from "./Activity";
import {Action} from "./Action";
import {ManagerEntity} from "./ManagerEntity";
import {RandomIdBaseEntity} from "./RandomIdBaseEntity";

@Entity()
export class Bot extends RandomIdBaseEntity {

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => ManagerEntity, obj => obj.bot)
    managers!: Promise<ManagerEntity[]>
}
