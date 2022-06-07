import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {ManagerEntity} from "./ManagerEntity";
import {RandomIdBaseEntity} from "./Base/RandomIdBaseEntity";

@Entity()
export class Bot extends RandomIdBaseEntity {

    @Column("varchar", {length: 200})
    name!: string;

    @OneToMany(type => ManagerEntity, obj => obj.bot)
    managers!: Promise<ManagerEntity[]>
}
