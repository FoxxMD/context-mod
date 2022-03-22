import {ChildEntity, ManyToOne} from "typeorm";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {TypedActivityState, FilterCriteriaResult as IFilterCriteriaResult} from "../../interfaces";
import {ActivityStateFilterCriteria} from "./ActivityStateFilterCriteria";

@ChildEntity()
export class ActivityStateFilterCriteriaResult extends FilterCriteriaResult<TypedActivityState> {

    type: string = 'activityState';

    @ManyToOne(type => ActivityStateFilterCriteria, {cascade: ['insert']})
    criteria!: ActivityStateFilterCriteria

    constructor(data?: IFilterCriteriaResult<TypedActivityState>) {
        super(data);
        if(data !== undefined) {
            this.criteria = new ActivityStateFilterCriteria({criteria: data.criteria});
        }
    }
}
