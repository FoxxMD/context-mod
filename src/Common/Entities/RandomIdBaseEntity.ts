import {BeforeInsert, Entity, PrimaryColumn} from "typeorm";
import {nanoid} from 'nanoid'

/*
* Wanted to use a random id that was smaller than a UUID since all these entities will (probably) be accessed through api endpoints at some point
* and they need to be url friendly
*
* ID Example: 4rTFo6yoQIFT6UTr
* */

@Entity()
export class RandomIdBaseEntity {

    @PrimaryColumn('varchar', {length: 20})
    id!: string

    @BeforeInsert()
    setId() {
        this.id = nanoid(16);
    }
}
