import {ChildEntity, ManyToOne} from "typeorm";
import {FilterCriteriaResult} from "./FilterCriteriaResult";
import {ActivityStateFilterCriteria} from "./ActivityStateFilterCriteria";
import {TypedActivityState} from "../../Infrastructure/Filters/FilterCriteria";
import {FilterCriteriaResult as IFilterCriteriaResult} from "../../Infrastructure/Filters/FilterShapes";

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
