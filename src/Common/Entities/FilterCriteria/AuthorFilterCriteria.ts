import {
    ChildEntity, DataSource
} from "typeorm";
import {FilterCriteria, FilterCriteriaOptions, filterCriteriaTypeIdentifiers} from "./FilterCriteria";
import objectHash from "object-hash";
import {AuthorCriteria} from "../../interfaces";

@ChildEntity()
export class AuthorFilterCriteria extends FilterCriteria<AuthorCriteria> {
    type: string = filterCriteriaTypeIdentifiers.author;

    constructor(data?: FilterCriteriaOptions<AuthorCriteria>) {
        super(data);
        if(data !== undefined) {
            this.generateId();
        }
    }
}
