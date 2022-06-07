import {ModAction, ModActionRaw} from "./ModAction";
import {Submission, RedditUser, Comment, Subreddit} from "snoowrap/dist/objects"
import {ModUserNote, ModUserNoteRaw} from "./ModUserNote";
//import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import dayjs, {Dayjs} from "dayjs";
import {generateSnoowrapEntityFromRedditThing, parseRedditFullname} from "../../util";
import Snoowrap from "snoowrap";
import {ModNoteType} from "../../Common/Infrastructure/Atomic";

export interface ModNoteRaw {
    subreddit_id: string
    operator_id: string
    mod_action_data: ModActionRaw
    subreddit: Subreddit
    user: RedditUser
    operator: string
    id: string
    user_note_data: ModUserNoteRaw
    user_id: string
    created_at: number
    type: ModNoteType | string
    cursor: string
}

export class ModNote {

    createdBy?: RedditUser | Subreddit
    createdByName?: string
    createdAt: Dayjs
    action: ModAction
    note: ModUserNote
    user: RedditUser
    cursor: string
    id: string
    subreddit: Subreddit
    type: string


    constructor(data: ModNoteRaw, client: Snoowrap) {

        this.createdByName = data.operator;
        this.createdAt = dayjs.unix(data.created_at);
        this.id = data.id;
        this.type = data.type;
        this.cursor = data.cursor;
        this.subreddit = data.subreddit;
        this.user = data.user;

        const opThing = parseRedditFullname(data.operator_id);
        if (opThing !== undefined) {
            this.createdBy = generateSnoowrapEntityFromRedditThing(opThing, client) as RedditUser | Subreddit;
            if(this.createdBy instanceof RedditUser) {
                this.createdBy.name = data.operator;
            }
        }
        this.action = new ModAction(data.mod_action_data, client);
        if (this.action.actedOn instanceof RedditUser && this.action.actedOn.id === data.user_id) {
            this.action.actedOn = this.user;
        }

        this.note = new ModUserNote(data.user_note_data, client);
        if (this.note.actedOn instanceof RedditUser && this.note.actedOn.id === data.user_id) {
            this.note.actedOn = this.user;
        }
    }
}
