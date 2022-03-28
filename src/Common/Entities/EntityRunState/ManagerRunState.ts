import {EntityRunState} from "./EntityRunState";
import {ChildEntity} from "typeorm";

@ChildEntity()
export class ManagerRunState extends EntityRunState {
    type = 'manager';
}
