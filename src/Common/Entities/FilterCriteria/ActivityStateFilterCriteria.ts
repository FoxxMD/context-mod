import {
    ChildEntity, DataSource
} from "typeorm";
import {FilterCriteria, FilterCriteriaOptions, filterCriteriaTypeIdentifiers} from "./FilterCriteria";
import objectHash from "object-hash";
import {TypedActivityState} from "../../Typings/Filters/FilterCriteria";

@ChildEntity()
export class ActivityStateFilterCriteria extends FilterCriteria<TypedActivityState> {
    type: string = filterCriteriaTypeIdentifiers.activityState;

    constructor(data?: FilterCriteriaOptions<TypedActivityState>) {
        super(data);
        if(data !== undefined) {
            this.generateId();
        }
    }
}
