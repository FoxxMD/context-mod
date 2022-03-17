import {
    ChildEntity
} from "typeorm";
import {FilterCriteria} from "./FilterCriteria";
import {AuthorCriteria} from "../../../Author/Author";

@ChildEntity()
export class AuthorFilterCriteria extends FilterCriteria<AuthorCriteria> {
    type: string = 'author';
}
