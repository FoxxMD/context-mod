import {Column, Entity, PrimaryColumn} from "typeorm";
import {TimeAwareBaseEntity} from "./Base/TimeAwareBaseEntity";
import {InviteData} from "../../Web/Common/interfaces";
import dayjs, {Dayjs} from "dayjs";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {parseRedditEntity} from "../../util";

@Entity({name: 'BotInvite'})
export class BotInvite extends TimeAwareRandomBaseEntity implements InviteData {

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

    @Column("simple-json")
    guests?: string[]

    @Column("text")
    initialConfig?: string

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

    constructor(data?: InviteData) {
        super();
        if (data !== undefined) {
            this.permissions = data.permissions;
            this.subreddits = data.subreddits;
            this.instance = data.instance;
            this.clientId = data.clientId;
            this.clientSecret = data.clientSecret;
            this.redirectUri = data.redirectUri;
            this.creator = data.creator;
            this.overwrite = data.overwrite;
            this.initialConfig = data.initialConfig;
            if(data.guests !== undefined && data.guests !== null && data.guests.length > 0) {
                const cleanGuests = data.guests.filter(x => x !== '').map(x => parseRedditEntity(x, 'user').name);
                if(cleanGuests.length > 0) {
                    this.guests = cleanGuests;
                }
            }

            if (data.expiresAt !== undefined && data.expiresAt !== 0) {
                this.expiresAt = dayjs(data.expiresAt);
            }
        }
    }
}
