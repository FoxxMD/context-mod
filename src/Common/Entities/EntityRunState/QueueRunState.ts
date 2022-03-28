import {EntityRunState} from "./EntityRunState";
import {ChildEntity} from "typeorm";

@ChildEntity()
export class QueueRunState extends EntityRunState {
    type = 'queue';
}
