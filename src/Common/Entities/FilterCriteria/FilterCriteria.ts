import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, TableInheritance, BeforeInsert} from "typeorm";
import objectHash from "object-hash";

export interface FilterCriteriaOptions<T> {
    criteria: T
}

@Entity()
@TableInheritance({ column: { type: "varchar", name: "type" } })
export abstract class FilterCriteria<T> {

    @PrimaryGeneratedColumn()
    id!: string;

    @Column("simple-json")
    criteria!: T;

    @Column("varchar", {length: 300})
    hash!: string

    @BeforeInsert()
    setHash() {
        this.hash = objectHash.sha1(this.criteria);
    }

    constructor(data?: FilterCriteriaOptions<T>) {
        if(data !== undefined) {
            this.criteria = data.criteria;
            this.hash = objectHash.sha1(this.criteria);
        }
    }
}
