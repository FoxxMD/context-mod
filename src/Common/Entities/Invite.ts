import {Entity, Column, PrimaryColumn} from "typeorm";
import {TimeAwareBaseEntity} from "./Base/TimeAwareBaseEntity";
import {InviteData} from "../../Web/Common/interfaces";
import dayjs, {Dayjs} from "dayjs";

@Entity()
export class Invite extends TimeAwareBaseEntity implements InviteData {

    @PrimaryColumn('varchar', {length: 255})
    id!: string

    @Column("varchar", {length: 50})
    clientId!: string;

    @Column("varchar", {length: 50})
    clientSecret!: string;

    @Column("text")
    redirectUri!: string;

    @Column("varchar", {length: 255})
    creator!: string;

    @Column("simple-json")
    permissions!: string[];

    @Column("varchar", {length: 200, nullable: true})
    instance?: string;

    @Column()
    overwrite?: boolean;

    @Column("simple-json", {nullable: true})
    subreddits?: string[];

    @Column({name: 'expiresAt', nullable: true})
    _expiresAt?: Date;

    public get expiresAt(): Dayjs | undefined {
        if (this._expiresAt === undefined) {
            return undefined;
        }
        return dayjs(this._expiresAt);
    }

    public set expiresAt(d: Dayjs | undefined) {
        if (d === undefined) {
            this._expiresAt = d;
        } else {
            this._expiresAt = d.utc().toDate();
        }
    }

    constructor(data?: InviteData & { id: string, expiresIn?: number }) {
        super();
        if (data !== undefined) {
            this.id = data.id;
            this.permissions = data.permissions;
            this.subreddits = data.subreddits;
            this.instance = data.instance;
            this.clientId = data.clientId;
            this.clientSecret = data.clientSecret;
            this.redirectUri = data.redirectUri;
            this.creator = data.creator;
            this.overwrite = data.overwrite;

            if (data.expiresIn !== undefined && data.expiresIn !== 0) {
                this.expiresAt = dayjs().add(data.expiresIn, 'seconds');
            }
        }
    }
}
