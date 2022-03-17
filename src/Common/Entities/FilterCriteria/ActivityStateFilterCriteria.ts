import {
    ChildEntity
} from "typeorm";
import {FilterCriteria} from "./FilterCriteria";
import {TypedActivityState} from "../../interfaces";

@ChildEntity()
export class ActivityStateFilterCriteria extends FilterCriteria<TypedActivityState> {
    type: string = 'activityState';
}
