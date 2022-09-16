import {AfterLoad, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn} from "typeorm";
import {InviteData, SubredditInviteData, SubredditInviteDataPersisted} from "../../Web/Common/interfaces";
import dayjs, {Dayjs} from "dayjs";
import {TimeAwareRandomBaseEntity} from "./Base/TimeAwareRandomBaseEntity";
import {AuthorEntity} from "./AuthorEntity";
import {Bot} from "./Bot";

@Entity()
export class SubredditInvite extends TimeAwareRandomBaseEntity implements SubredditInviteData {

    @PrimaryColumn("varchar", {length: 255})
    subreddit!: string;

    @Column("simple-json", {nullable: true})
    guests?: string[]

    @Column("text")
    initialConfig?: string

    @PrimaryColumn("varchar", {length: 200})
    messageId?: string

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

    constructor(data?: SubredditInviteData & { expiresIn?: number, bot: Bot }) {
        super();
        if (data !== undefined) {
            this.subreddit = data.subreddit;
            this.initialConfig = data.initialConfig === null ? undefined : data.initialConfig;
            this.guests = data.guests === null || data.guests === undefined ? [] : data.guests;
            this.bot = data.bot;


            if (data.expiresIn !== undefined && data.expiresIn !== 0) {
                this.expiresAt = dayjs().add(data.expiresIn, 'seconds');
            }
        }
    }

    toSubredditInviteData(): SubredditInviteDataPersisted {
        return {
            id: this.id,
            subreddit: this.subreddit,
            initialConfig: this.getInitialConfig(),
            guests: this.getGuests(),
            expiresAt: this.expiresAt !== undefined ? this.expiresAt.unix() : undefined,
        }
    }

    getGuests(): string[] {
        if(this.guests === null || this.guests === undefined) {
            return [];
        }
        return this.guests;
    }

    getInitialConfig(): string | undefined {
        if(this.initialConfig === null) {
            return undefined;
        }
        return this.initialConfig;
    }

    canAutomaticallyAccept() {
        return this.getGuests().length === 0 && this.getInitialConfig() === undefined;
        // TODO setup inbox checking to look for reply to messageId (eventually!)
    }

    @AfterLoad()
    fixNullable() {
        if(this.guests === null) {
            this.guests = undefined;
        }
        if(this.initialConfig === null) {
            this.initialConfig = undefined;
        }
    }

}
