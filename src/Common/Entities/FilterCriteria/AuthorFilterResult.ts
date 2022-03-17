import {ChildEntity, ManyToOne, OneToMany} from "typeorm";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {AuthorCriteria} from "../../../Author/Author";
import {FilterCriteria} from "./FilterCriteria";
import {AuthorFilterCriteria} from "./AuthorFilterCriteria";
import {FilterResult} from "./FilterResult";
import {FilterCriteriaResult as IFilterCriteriaResult} from "../../interfaces";
import {AuthorFilterCriteriaResult} from "./AuthorFilterCriteriaResult";

@ChildEntity()
export class AuthorFilterResult extends FilterResult<AuthorCriteria> {

    type: string = 'author';

    @OneToMany(type => AuthorFilterCriteriaResult, obj => obj.filterResult, {cascade: ['insert']})
    criteriaResults!: IFilterCriteriaResult<AuthorCriteria>[]
}
