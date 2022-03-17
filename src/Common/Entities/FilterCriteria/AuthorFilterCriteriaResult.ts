import {ChildEntity, ManyToOne} from "typeorm";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {AuthorCriteria} from "../../../Author/Author";
import {FilterCriteria} from "./FilterCriteria";
import {AuthorFilterCriteria} from "./AuthorFilterCriteria";

@ChildEntity()
export class AuthorFilterCriteriaResult extends FilterCriteriaResult<AuthorCriteria> {

    type: string = 'author';

    @ManyToOne(type => AuthorFilterCriteria)
    criteria!: AuthorFilterCriteria
}
