import {ChildEntity, Column, Entity, ManyToOne, TableInheritance} from "typeorm";
import {
    FilterCriteriaPropertyResult,
    FilterCriteriaResult as IFilterCriteriaResult
} from "../../interfaces";
import {FilterResult} from "./FilterResult";
import {RandomIdBaseEntity} from "../Base/RandomIdBaseEntity";
import {AuthorFilterCriteria} from "./AuthorFilterCriteria";
import {AuthorCriteria} from "../../Infrastructure/Filters/FilterCriteria";

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

@ChildEntity()
export class AuthorFilterCriteriaResult extends FilterCriteriaResult<AuthorCriteria> {

    type: string = 'author';

    @ManyToOne(type => AuthorFilterCriteria, {cascade: ['insert'], eager: true})
    criteria!: AuthorFilterCriteria

    constructor(data?: IFilterCriteriaResult<AuthorCriteria>) {
        super(data);
        if (data !== undefined) {
            this.criteria = new AuthorFilterCriteria(data.criteria);
        }
    }
}
