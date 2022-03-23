import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, ManyToOne, TableInheritance} from "typeorm";
import {FilterCriteriaResult as IFilterCriteriaResult, JoinOperands} from "../../interfaces";
import {RandomIdBaseEntity} from "../Base/RandomIdBaseEntity";

export interface FilterResultOptions {
    passed: boolean
    join: JoinOperands
}

@Entity()
@TableInheritance({column: {type: "varchar", name: "type"}})
export abstract class FilterResult<T> extends RandomIdBaseEntity {


    // @OneToMany(type => FilterCriteriaResult, obj => obj.filterResult, {cascade: ['insert']})
    // criteriaResults!: IFilterCriteriaResult<T>[]

    @Column("varchar", {length: 200})
    join!: JoinOperands

    @Column("boolean")
    passed!: boolean

    constructor(data?: FilterResultOptions) {
        super();
        if (data !== undefined) {
            this.join = data.join;
            this.passed = data.passed
        }
    }
}
