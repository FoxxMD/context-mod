import {EntityRunState} from "./EntityRunState";
import {ChildEntity} from "typeorm";

@ChildEntity()
export class EventsRunState extends EntityRunState {
    type = 'events';
}
