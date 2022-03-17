import {ChildEntity, ManyToOne} from "typeorm";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {AuthorCriteria} from "../../../Author/Author";
import {TypedActivityState} from "../../interfaces";
import {AuthorFilterCriteria} from "./AuthorFilterCriteria";
import {ActivityStateFilterCriteria} from "./ActivityStateFilterCriteria";

@ChildEntity()
export class ActivityStateFilterCriteriaResult extends FilterCriteriaResult<TypedActivityState> {

    type: string = 'activityState';

    @ManyToOne(type => ActivityStateFilterCriteria)
    criteria!: ActivityStateFilterCriteria
}
