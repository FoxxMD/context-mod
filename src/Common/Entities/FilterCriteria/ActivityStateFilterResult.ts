import {ChildEntity, OneToMany} from "typeorm";
import {FilterResult} from "./FilterResult";
import {FilterCriteriaResult as IFilterCriteriaResult, TypedActivityState} from "../../interfaces";
import {ActivityStateFilterCriteriaResult} from "./ActivityStateFilterCriteriaResult";

@ChildEntity()
export class ActivityStateFilterResult extends FilterResult<TypedActivityState> {

    type: string = 'activityState';

    @OneToMany(type => ActivityStateFilterCriteriaResult, obj => obj.filterResult, {cascade: ['insert']})
    criteriaResults!: IFilterCriteriaResult<TypedActivityState>[]
}
