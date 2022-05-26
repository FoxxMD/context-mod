import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    OneToMany,
    VersionColumn,
    ManyToOne,
    JoinColumn,
    PrimaryColumn, CreateDateColumn, UpdateDateColumn, BeforeInsert, BeforeUpdate
} from "typeorm";
import {ActionResultEntity} from "./ActionResultEntity";
import objectHash from "object-hash";
import {ObjectPremise} from "../interfaces";
import {TimeAwareAndUpdatedBaseEntity} from "./Base/TimeAwareAndUpdatedBaseEntity";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {ActionType} from "./ActionType";
import {ManagerEntity} from "./ManagerEntity";
import {capitalize} from "lodash";
import {TypedActivityStates} from "../Infrastructure/Filters/FilterCriteria";
import {AuthorOptions, ItemOptions} from "../Infrastructure/Filters/FilterShapes";

export interface ActionPremiseOptions {
    kind: ActionType
    config: ObjectPremise
    active?: boolean
    manager: ManagerEntity
    name?: string
}

@Entity()
export class ActionPremise extends TimeAwareRandomBaseEntity  {

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => ActionType, undefined,{eager: true})
    @JoinColumn({name: 'kindId'})
    kind!: ActionType;

    @Column()
    kindId!: string

    @Column("simple-json")
    config!: any

    @Column("varchar", {length: 300})
    configHash!: string;

    @Column()
    active!: boolean

    @OneToMany(type => ActionResultEntity, obj => obj.premise) // note: we will create author property in the Photo class below
    actionResults!: ActionResultEntity[]

    @ManyToOne(type => ManagerEntity, act => act.rules)
    @JoinColumn({name: 'managerId'})
    manager!: ManagerEntity;

    @Column()
    managerId!: string

    @Column("simple-json", {nullable: true})
    itemIsConfig?: ItemOptions

    @Column("varchar", {length: 300, nullable: true})
    itemIsConfigHash?: string;

    @Column("simple-json", {nullable: true})
    authorIsConfig?: AuthorOptions

    @Column("varchar", {length: 300, nullable: true})
    authorIsConfigHash?: string;

    constructor(data?: ActionPremiseOptions) {
        super();
        if (data !== undefined) {
            this.kind = data.kind;
            this.config = data.config.config;
            this.active = data.active ?? true;
            this.configHash = objectHash.sha1(data.config);
            this.manager = data.manager;
            this.managerId = data.manager.id;
            this.name = data.name;

            const {
                authorIs: {
                    include = [],
                    exclude = [],
                } = {},
                itemIs: {
                    include: includeItemIs = [],
                    exclude: excludeItemIs = [],
                    excludeCondition: ecItemIs,
                } = {},
            } = data.config;

            if (includeItemIs.length > 0 || excludeItemIs.length > 0) {
                if (includeItemIs.length > 0) {
                    this.itemIsConfig = {
                        include: includeItemIs
                    };
                } else {
                    this.itemIsConfig = {
                        excludeCondition: ecItemIs,
                        exclude: excludeItemIs
                    }
                }
                this.itemIsConfigHash = objectHash.sha1(this.itemIsConfig);
            }
            if (include.length > 0 || exclude.length > 0) {
                if (include.length > 0) {
                    this.authorIsConfig = {
                        include
                    };
                } else {
                    this.authorIsConfig = {
                        excludeCondition: data.config.authorIs?.excludeCondition,
                        exclude
                    }
                }
                this.authorIsConfigHash = objectHash.sha1(this.authorIsConfig);
            }
        }
    }

    getFriendlyIdentifier() {
        return this.name === undefined ? capitalize(this.kind.name) : `${capitalize(this.kind.name)} - ${this.name}`;
    }

    static getFriendlyIdentifier(actionLike: any) {
        const action = actionLike as ActionPremise;

        return action.name === undefined ? capitalize(action.kind.name) : `${capitalize(action.kind.name)} - ${action.name}`;
    }
}
