import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    JoinColumn,
    OneToMany,
    VersionColumn,
    ManyToOne,
    PrimaryColumn,
    CreateDateColumn, UpdateDateColumn, BeforeUpdate, OneToOne, Index
} from "typeorm";
import {RuleResultEntity} from "./RuleResultEntity";
import {
    ObjectPremise
} from "../interfaces";
import objectHash from "object-hash";
import {TimeAwareAndUpdatedBaseEntity} from "./Base/TimeAwareAndUpdatedBaseEntity";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {RuleType} from "./RuleType";
import {ManagerEntity} from "./ManagerEntity";
import {capitalize} from "lodash";
import {TypedActivityStates} from "../Infrastructure/Filters/FilterCriteria";
import {AuthorOptions, ItemOptions} from "../Infrastructure/Filters/FilterShapes";

export interface RulePremiseOptions {
    kind: RuleType
    config: ObjectPremise
    active?: boolean
    manager: ManagerEntity
    name?: string
}

@Entity()
@Index(['kindId','config', 'managerId', 'itemIsConfigHash','authorIsConfigHash', 'name'], { unique: true })
export class RulePremise extends TimeAwareRandomBaseEntity {

    @Column("varchar", {length: 300, nullable: true})
    name?: string;

    @ManyToOne(() => RuleType, undefined, {eager: true})
    @JoinColumn({name: 'kindId'})
    kind!: RuleType;

    @Column()
    kindId!: string

    @Column("varchar", {length: 300})
    configHash!: string;

    @Column("simple-json")
    config!: any

    @Column()
    active!: boolean

    @OneToMany(type => RuleResultEntity, obj => obj.premise) // note: we will create author property in the Photo class below
    ruleResults!: RuleResultEntity[]

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

    constructor(data?: RulePremiseOptions) {
        super();
        if (data !== undefined) {
            this.kind = data.kind;
            this.config = data.config.config;
            this.active = data.active ?? true;
            this.configHash = objectHash.sha1(data.config);
            this.manager = data.manager;
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

    static getFriendlyIdentifier(ruleLike: any) {
        const rule = ruleLike as RulePremise;

        return rule.name === undefined ? capitalize(rule.kind.name) : `${capitalize(rule.kind.name)} - ${rule.name}`;
    }
}
