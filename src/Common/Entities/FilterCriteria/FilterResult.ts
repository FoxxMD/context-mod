import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, ManyToOne, TableInheritance} from "typeorm";
import {FilterCriteriaResult as IFilterCriteriaResult, JoinOperands} from "../../interfaces";

export interface FilterResultOptions {
    passed: boolean
    join: JoinOperands
}

@Entity()
@TableInheritance({column: {type: "varchar", name: "type"}})
export abstract class FilterResult<T> {

    @PrimaryGeneratedColumn()
    id!: string;

    // @OneToMany(type => FilterCriteriaResult, obj => obj.filterResult, {cascade: ['insert']})
    // criteriaResults!: IFilterCriteriaResult<T>[]

    @Column("varchar", {length: 200})
    join!: JoinOperands

    @Column("boolean")
    passed!: boolean

    constructor(data?: FilterResultOptions) {
        if (data !== undefined) {
            this.join = data.join;
            this.passed = data.passed
        }
    }
}
