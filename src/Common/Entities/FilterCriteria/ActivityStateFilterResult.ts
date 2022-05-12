import {ChildEntity, OneToMany} from "typeorm";
import {FilterResult} from "./FilterResult";
import {ActivityStateFilterCriteriaResult} from "./ActivityStateFilterCriteriaResult";
import {TypedActivityState} from "../../Infrastructure/Filters/FilterCriteria";
import {
    FilterCriteriaResult as IFilterCriteriaResult,
    FilterResult as IFilterResult
} from "../../Infrastructure/Filters/FilterShapes";

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
