import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToOne, JoinColumn, CreateDateColumn} from "typeorm";
import {ActivityStateFilterResult} from "./FilterCriteria/ActivityStateFilterResult";
import {AuthorFilterResult} from "./FilterCriteria/AuthorFilterResult";
import {CheckResultEntity} from "./CheckResultEntity";
import {ActionPremise} from "./ActionPremise";
import {FilterResult, FilterResult as IFilterResult, TypedActivityState} from "../interfaces";
import {AuthorCriteria} from "../../Author/Author";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import RedditUser from "snoowrap/dist/objects/RedditUser";

export interface ActionResultEntityOptions {
    run: boolean
    result?: string
    runReason?: string
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
    premise: ActionPremise
    success: boolean
    touchedEntities?: (Comment | Submission)[]
    dryRun: boolean
}

@Entity({name: 'ActionResult'})
export class ActionResultEntity {

    @PrimaryGeneratedColumn()
    id!: number;

    @Column("boolean")
    run!: boolean;

    @Column("boolean")
    dryRun!: boolean;

    @Column("boolean")
    success!: boolean;

    @Column("text", {nullable: true})
    runReason?: string

    @Column("text", {nullable: true})
    result?: string

    @OneToOne(() => ActivityStateFilterResult, {nullable: true, cascade: ['insert']})
    @JoinColumn({name: 'itemIs'})
    private _itemIs?: ActivityStateFilterResult

    @OneToOne(() => AuthorFilterResult, {nullable: true, cascade: ['insert']})
    @JoinColumn({name: 'authorIs'})
    private _authorIs?: AuthorFilterResult

    @CreateDateColumn()
    createdAt!: number

    @ManyToOne(type => CheckResultEntity, act => act.actionResults, /*{cascade: ['insert']}*/)
    checkResult!: CheckResultEntity;

    @ManyToOne(type => ActionPremise, act => act.actionResults, /*{cascade: ['insert']}*/)
    premise!: ActionPremise;

    touchedEntities: (Submission | Comment | RedditUser | string)[] = []

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

    constructor(data?: ActionResultEntityOptions) {
        if (data !== undefined) {
            this.result = data.result;
            this.run = data.run;
            this.runReason = data.runReason;
            this.success = data.success;
            this.dryRun = data.dryRun;
            this.itemIs = data.itemIs ? new ActivityStateFilterResult(data.itemIs) : undefined;
            this.authorIs = data.authorIs ? new AuthorFilterResult(data.authorIs) : undefined;
            this.premise = data.premise;
            if(data.touchedEntities !== undefined) {
                this.touchedEntities = data.touchedEntities
            }
        }
    }
}
