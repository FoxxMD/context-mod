import {Entity, PrimaryColumn, Column, DataSource} from "typeorm";

export interface WebSettingOptions {
    name: string
    value: any
}

@Entity()
export class WebSetting {

    @PrimaryColumn()
    name!: string

    @Column({type: 'varchar', length: 255})
    value!: any

    constructor(data?: WebSettingOptions) {
        if (data !== undefined) {
            this.name = data.name;
            this.value = data.value;
        }
    }
}

// export const InstanceRepository = (source: DataSource) => source.getRepository(InstanceSetting).extend({
//     get
// })
