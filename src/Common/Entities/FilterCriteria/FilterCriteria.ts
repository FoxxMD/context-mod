import {Entity, Column, PrimaryColumn, OneToMany, PrimaryGeneratedColumn, TableInheritance, BeforeInsert} from "typeorm";
import objectHash from "object-hash";
import {removeUndefinedKeys} from "../../../util";
import {RandomIdBaseEntity} from "../Base/RandomIdBaseEntity";

export interface FilterCriteriaOptions<T> {
    criteria: T
}

export const filterCriteriaTypeIdentifiers = {
    author: 'author',
    activityState: 'activityState'
}

@Entity()
@TableInheritance({ column: { type: "varchar", name: "type", update: false } })
export abstract class FilterCriteria<T> extends RandomIdBaseEntity {

    // @PrimaryColumn()
    // id!: string

    @Column("simple-json")
    criteria!: T;

    @Column("varchar", {length: 300})
    hash!: string

    @Column()
    type!: string

    // this does not work, id needs to be set before insert or else it tries to insert non-unique
    // (doesn't do hook before computing?? idk)
    //
    // @BeforeInsert()
    // setId() {
    //     this.id = `${this.type}-${this.hash}`
    // }

    constructor(data?: FilterCriteriaOptions<T>) {
        super();
        if(data !== undefined) {
            this.criteria = removeUndefinedKeys(data.criteria);
            this.hash = objectHash.sha1(this.criteria);
        }
    }
}


// this is the ideal entity where the primary key is a composite of type-hash
// but for some reason typeorm throws with empty values on update execution when criteria is also cascaded from results
// so we have to use the working entity above, with one primary column we compute ourselves from type-hash
// TODO make a reproducible example and submit an issue to typeorm
// possible related issues: https://github.com/typeorm/typeorm/issues/5489
// https://github.com/typeorm/typeorm/issues/4501
//
// @Entity()
// @TableInheritance({ column: { type: "varchar", name: "type", primary: true } })
// export abstract class FilterCriteria<T> {
//
//     @Column("simple-json")
//     criteria!: T;
//
//     @PrimaryColumn("varchar", {length: 300})
//     hash!: string
//
//     // @PrimaryColumn()
//     // type!: string
//
//     @BeforeInsert()
//     setHash() {
//         this.hash = objectHash.sha1(this.criteria);
//     }
//
//     constructor(data?: FilterCriteriaOptions<T>) {
//         if(data !== undefined) {
//             this.criteria = data.criteria;
//             this.hash = objectHash.sha1(this.criteria);
//         }
//     }
// }
