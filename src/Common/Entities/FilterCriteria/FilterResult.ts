import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, ManyToOne, TableInheritance} from "typeorm";
import {FilterCriteriaResult as IFilterCriteriaResult, JoinOperands} from "../../interfaces";
import {FilterCriteria} from "./FilterCriteria";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {RuleResult} from "../RuleResult";

@Entity()
@TableInheritance({ column: { type: "varchar", name: "type" } })
export abstract class FilterResult<T> {

    @PrimaryGeneratedColumn()
    id!: string;

    // @OneToMany(type => FilterCriteriaResult, obj => obj.filterResult, {cascade: ['insert']})
    // criteriaResults!: IFilterCriteriaResult<T>[]

    @Column("varchar", {length: 200})
    join!: JoinOperands

    @Column("boolean")
    passed!: boolean
}
