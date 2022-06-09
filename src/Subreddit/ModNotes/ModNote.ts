import {ModAction, ModActionRaw} from "./ModAction";
import {Submission, RedditUser, Comment, Subreddit} from "snoowrap/dist/objects"
import {ModUserNote, ModUserNoteRaw} from "./ModUserNote";
//import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import dayjs, {Dayjs} from "dayjs";
import {generateSnoowrapEntityFromRedditThing, parseRedditFullname} from "../../util";
import Snoowrap from "snoowrap";
import {ModActionType, ModUserNoteLabel} from "../../Common/Infrastructure/Atomic";
import {RedditThing} from "../../Common/Infrastructure/Reddit";

export interface ModNoteSnoowrapPopulated extends Omit<ModNoteRaw, 'subreddit' | 'user'> {
    subreddit: Subreddit
    user: RedditUser
}

export interface CreateModNoteData {
    user: RedditUser
    subreddit: Subreddit
    activity?: Submission | Comment | RedditUser
    label?: ModUserNoteLabel
    note?: string
}

export const asCreateModNoteData = (val: any): val is CreateModNoteData => {
    if(val !== null && typeof val === 'object') {
        return val.user instanceof RedditUser && val.subreddit instanceof Subreddit && typeof val.note === 'string';
    }
    return false;
}


export interface ModNoteRaw {
    subreddit: string
    subreddit_id: string

    user: string
    user_id: string

    operator: string
    operator_id: string

    id: string
    created_at: number
    cursor?: string
    type: ModActionType | string
    mod_action_data: ModActionRaw
    user_note_data: ModUserNoteRaw
}

export class ModNote {

    createdBy: RedditUser | Subreddit
    createdByName?: string
    createdAt: Dayjs
    action: ModAction
    note: ModUserNote
    user: RedditUser
    operatorVal: string
    cursor?: string
    id: string
    subreddit: Subreddit
    type: ModActionType | string


    constructor(data: ModNoteRaw, client: Snoowrap) {

        this.createdByName = data.operator;
        this.createdAt = dayjs.unix(data.created_at);
        this.id = data.id;
        this.type = data.type;
        this.cursor = data.cursor;

        this.subreddit = new Subreddit({display_name: data.subreddit, id: data.subreddit_id}, client, false);
        this.user = new RedditUser({name: data.user, id: data.user_id}, client, false);

        this.operatorVal = data.operator;

        const opThing = parseRedditFullname(data.operator_id) as RedditThing;
        this.createdBy = generateSnoowrapEntityFromRedditThing(opThing, client) as RedditUser | Subreddit;
        if (this.createdBy instanceof RedditUser) {
            this.createdBy.name = data.operator;
        }

        this.action = new ModAction(data.mod_action_data, client);
        if (this.action.actedOn instanceof RedditUser && this.action.actedOn.id === this.user.id) {
            this.action.actedOn = this.user;
        }

        this.note = new ModUserNote(data.user_note_data, client);
        if (this.note.actedOn instanceof RedditUser && this.note.actedOn.id === this.user.id) {
            this.note.actedOn = this.user;
        }
    }

    toRaw(): ModNoteRaw {
        return {
            subreddit: this.subreddit.display_name,
            subreddit_id: this.subreddit.id,

            user: this.user.name,
            user_id: this.user.id,

            operator: this.operatorVal,
            operator_id: this.createdBy.id,

            mod_action_data: this.action.toRaw(),

            id: this.id,
            user_note_data: this.note.toRaw(),
            created_at: this.createdAt.unix(),
            type: this.type,
            cursor: this.cursor
        }
    }

    toJSON() {
        return this.toRaw();
    }
}
