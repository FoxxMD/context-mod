import { ISession } from "connect-typeorm";
import { Column, Entity, Index, PrimaryColumn } from "typeorm";
@Entity()
export class ClientSession implements ISession {
    @Index()
    @Column("bigint", {transformer: { from: Number, to: Number }})
    public expiredAt = Date.now();

    @PrimaryColumn("varchar", { length: 255 })
    public id = "";

    @Column("text")
    public json = "";

    @Column({ name: 'destroyedAt', nullable: true })
    destroyedAt?: Date;
}
