import {
    Entity,
    Column,
    PrimaryColumn,
    OneToMany,
    PrimaryGeneratedColumn,
    OneToOne,
    TableInheritance,
    ManyToOne
} from "typeorm";
import {InvokeeType} from "../InvokeeType";
import {RunStateType} from "../RunStateType";
import {RunningState} from "../../../Subreddit/Manager";

export interface EntityRunStateOptions {
    invokee: InvokeeType
    runType: RunStateType
}

@Entity()
@TableInheritance({column: {type: "varchar", name: "type"}})
export abstract class EntityRunState {

    @PrimaryGeneratedColumn()
    id?: number;

    @OneToOne(() => InvokeeType)
    @ManyToOne(() => InvokeeType, undefined,{eager: true})
    invokee!: InvokeeType

    @OneToOne(() => RunStateType)
    @ManyToOne(() => RunStateType, undefined,{eager: true})
    runType!: RunStateType

    constructor(data?: EntityRunStateOptions) {
        if (data !== undefined) {
            this.invokee = data.invokee;
            this.runType = data.runType;
        }
    }

    toRunningState(): RunningState {
        return {
            state: this.runType.name,
            causedBy: this.invokee.name
        }
    }
}
