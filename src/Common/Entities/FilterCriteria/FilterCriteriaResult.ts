import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, TableInheritance, ManyToOne} from "typeorm";
import {FilterCriteria} from "./FilterCriteria";
import {FilterCriteriaPropertyResult} from "../../interfaces";
import {Activity} from "../Activity";
import {FilterResult} from "./FilterResult";

@Entity()
@TableInheritance({ column: { type: "varchar", name: "type" } })
export abstract class FilterCriteriaResult<T> {

    @PrimaryGeneratedColumn()
    id!: string;

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
}
