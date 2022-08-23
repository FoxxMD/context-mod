import {Column, Entity, JoinColumn, ManyToOne, PrimaryColumn} from "typeorm";
import {InviteData, SubredditInviteData} from "../../Web/Common/interfaces";
import dayjs, {Dayjs} from "dayjs";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {AuthorEntity} from "./AuthorEntity";
import {Bot} from "./Bot";

@Entity()
export class SubredditInvite extends TimeAwareRandomBaseEntity implements SubredditInviteData {

    subreddit!: string;

    @Column("simple-json", {nullable: true})
    guests?: string[]

    @Column("text")
    initialConfig?: string

    @ManyToOne(type => Bot, bot => bot.subredditInvites, {nullable: false, orphanedRowAction: 'delete'})
    @JoinColumn({name: 'botId', referencedColumnName: 'id'})
    bot!: Bot;

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

    constructor(data?: SubredditInviteData & { expiresIn?: number }) {
        super();
        if (data !== undefined) {
            this.subreddit = data.subreddit;
            this.initialConfig = data.initialConfig;
            this.guests = data.guests;


            if (data.expiresIn !== undefined && data.expiresIn !== 0) {
                this.expiresAt = dayjs().add(data.expiresIn, 'seconds');
            }
        }
    }
}
