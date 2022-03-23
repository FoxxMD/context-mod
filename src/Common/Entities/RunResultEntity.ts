import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    OneToOne,
    ManyToOne,
    PrimaryColumn,
    JoinColumn, CreateDateColumn, AfterLoad
} from "typeorm";
import {ManagerEntity} from "./ManagerEntity";
import {Activity} from "./Activity";
import {RunEntity} from "./RunEntity";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckResultEntity} from "./CheckResultEntity";
import {RuleResultEntity} from "./RuleResultEntity";
import {CMEvent} from "./CMEvent";
import {FilterResult as IFilterResult, TypedActivityState} from "../interfaces";
import {AuthorCriteria} from "../../Author/Author";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";

export interface RunResultEntityOptions {
    run: RunEntity
    triggered?: boolean
}

@Entity({name: 'RunResult'})
export class RunResultEntity extends TimeAwareRandomBaseEntity {

    @ManyToOne(type => RunEntity, act => act.results, /*{cascade: ['insert']}*/)
    run!: RunEntity;

    @ManyToOne(type => CMEvent, act => act.runResults, /*{cascade: ['insert']}*/)
    event!: CMEvent;

    @Column("boolean")
    triggered!: boolean;

    @Column("text", {nullable: true})
    reason?: string;

    @Column("text", {nullable: true})
    error?: string;

    @OneToOne(() => ActivityStateFilterResult, {nullable: true, cascade: ['insert'], eager: true})
    @JoinColumn({name: 'itemIs'})
    _itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true, cascade: ['insert'], eager: true})
    @JoinColumn({name: 'authorIs'})
    _authorIs?: AuthorFilterResult

    @OneToMany(type => CheckResultEntity, obj => obj.run, {cascade: ['insert', 'update'], eager: true})
    checkResults!: CheckResultEntity[]

    @AfterLoad()
    sortRuns() {
        this.checkResults.sort((a, b) => a.createdAt.isSameOrBefore(b.createdAt) ?  -1 : 1);
    }

    set itemIs(data: ActivityStateFilterResult | IFilterResult<TypedActivityState> | undefined) {
        if (data === undefined) {
            this._itemIs = undefined;
        } else if (data instanceof ActivityStateFilterResult) {
            this._itemIs = data;
        } else {
            this._itemIs = new ActivityStateFilterResult(data);
        }
    }

    get itemIs() {
        return this._itemIs;
    }

    set authorIs(data: AuthorFilterResult | IFilterResult<AuthorCriteria> | undefined) {
        if (data === undefined) {
            this._authorIs = undefined;
        } else if (data instanceof AuthorFilterResult) {
            this._authorIs = data;
        } else {
            this._authorIs = new AuthorFilterResult(data);
        }
    }

    get authorIs() {
        return this._authorIs;
    }

    constructor(data?: RunResultEntityOptions) {
        super();
        if (data !== undefined) {
            this.run = data.run;
            this.triggered = data.triggered ?? false;
        }
    }
}
