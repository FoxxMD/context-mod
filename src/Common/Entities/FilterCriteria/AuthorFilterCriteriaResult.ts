import {ChildEntity, ManyToOne} from "typeorm";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {AuthorCriteria} from "../../../Author/Author";
import {AuthorFilterCriteria} from "./AuthorFilterCriteria";
import {FilterCriteriaResult as IFilterCriteriaResult, TypedActivityState} from "../../interfaces";

@ChildEntity()
export class AuthorFilterCriteriaResult extends FilterCriteriaResult<AuthorCriteria> {

    type: string = 'author';

    @ManyToOne(type => AuthorFilterCriteria, {cascade: ['insert'], eager: true})
    criteria!: AuthorFilterCriteria

    constructor(data?: IFilterCriteriaResult<AuthorCriteria>) {
        super(data);
        if(data !== undefined) {
            this.criteria = new AuthorFilterCriteria({criteria: data.criteria});
        }
    }
}
