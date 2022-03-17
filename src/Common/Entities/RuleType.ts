import {Column, Entity, PrimaryGeneratedColumn} from "typeorm";

@Entity()
export class RuleType  {

    @PrimaryGeneratedColumn()
    id!: string;

    @Column("varchar", {length: 200})
    name!: string;
}
