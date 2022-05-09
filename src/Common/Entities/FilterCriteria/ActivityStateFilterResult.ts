import {ChildEntity, OneToMany} from "typeorm";
import {FilterResult} from "./FilterResult";
import {FilterCriteriaResult as IFilterCriteriaResult, FilterResult as IFilterResult} from "../../interfaces";
import {ActivityStateFilterCriteriaResult} from "./ActivityStateFilterCriteriaResult";
import {TypedActivityState} from "../../Typings/Filters/FilterCriteria";

@ChildEntity()
export class ActivityStateFilterResult extends FilterResult<TypedActivityState> {

    type: string = 'activityState';

    @OneToMany(type => ActivityStateFilterCriteriaResult, obj => obj.filterResult, {cascade: ['insert'], eager: true})
    criteriaResults!: ActivityStateFilterCriteriaResult[]

    constructor(data?: IFilterResult<TypedActivityState>) {
        super(data);
        if(data !== undefined) {
            this.criteriaResults = data.criteriaResults.map(x => new ActivityStateFilterCriteriaResult(x))
        }
    }
}
