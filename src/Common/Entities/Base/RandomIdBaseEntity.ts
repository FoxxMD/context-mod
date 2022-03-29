import {BeforeInsert, Entity, PrimaryColumn} from "typeorm";
import {nanoid} from "nanoid";

export abstract class RandomIdBaseEntity {

    /*
    * Wanted to use a random id that was smaller than a UUID since all these entities will (probably) be accessed through api endpoints at some point
    * and they need to be url friendly
    *
    * ID Example: 4rTFo6yoQIFT6UTr
    * */


    @PrimaryColumn('varchar', {length: 20})
    id!: string

    @BeforeInsert()
    setId() {
        this.id = nanoid(16);
    }

    toJSON() {
        const jsonObj: any = Object.assign({}, this);
        const proto = Object.getPrototypeOf(this);
        for (const key of Object.getOwnPropertyNames(proto)) {
            const desc = Object.getOwnPropertyDescriptor(proto, key);
            const hasGetter = desc && typeof desc.get === 'function';
            if (hasGetter) {
                jsonObj[key] = (this as any)[key];
                const regKey = `_${key}`;
                if(jsonObj[regKey] !== undefined) {
                    delete jsonObj[regKey];
                }
            }
        }
        return jsonObj;
    }
}
