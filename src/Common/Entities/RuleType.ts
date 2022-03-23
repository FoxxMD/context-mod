import {Column, Entity, PrimaryGeneratedColumn} from "typeorm";

@Entity()
export class RuleType  {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("varchar", {length: 200})
    name!: string;
}
