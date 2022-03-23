import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, TableInheritance, ManyToOne} from "typeorm";
import {FilterCriteriaPropertyResult} from "../../interfaces";
import {FilterResult} from "./FilterResult";
import {RandomIdBaseEntity} from "../RandomIdBaseEntity";

export interface FilterCriteriaResultOptions<T> {
    behavior: string
    propertyResults: FilterCriteriaPropertyResult<T>[]
    passed: boolean
}

@Entity()
@TableInheritance({ column: { type: "varchar", name: "type" } })
export abstract class FilterCriteriaResult<T> extends RandomIdBaseEntity {

    @Column("varchar", {length: 20})
    behavior!: string;

    // @ManyToOne(type => FilterCriteria)
    // criteria!: FilterCriteria<T>

    @Column("simple-json")
    propertyResults!: FilterCriteriaPropertyResult<T>[]

    @Column("boolean")
    passed!: boolean

    @ManyToOne(type => FilterResult)
    filterResult!: FilterResult<T>

    constructor(data?: FilterCriteriaResultOptions<T>) {
        super();
        if(data !== undefined) {
            this.behavior = data.behavior;
            this.passed = data.passed;
            this.propertyResults = data.propertyResults;
        }
    }
}
