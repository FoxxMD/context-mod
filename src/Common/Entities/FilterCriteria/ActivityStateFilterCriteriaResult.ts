import {ChildEntity, ManyToOne} from "typeorm";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {FilterCriteriaResult as IFilterCriteriaResult} from "../../interfaces";
import {ActivityStateFilterCriteria} from "./ActivityStateFilterCriteria";
import {TypedActivityState} from "../../Typings/Filters/FilterCriteria";

@ChildEntity()
export class ActivityStateFilterCriteriaResult extends FilterCriteriaResult<TypedActivityState> {

    type: string = 'activityState';

    @ManyToOne(type => ActivityStateFilterCriteria, {cascade: ['insert'], eager: true})
    criteria!: ActivityStateFilterCriteria

    constructor(data?: IFilterCriteriaResult<TypedActivityState>) {
        super(data);
        if(data !== undefined) {
            this.criteria = new ActivityStateFilterCriteria(data.criteria);
        }
    }
}
