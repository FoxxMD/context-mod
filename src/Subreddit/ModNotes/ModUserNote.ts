import {Comment, PrivateMessage, RedditUser, Submission} from "snoowrap/dist/objects";
import {ModUserNoteLabel} from "../../Common/Infrastructure/Atomic";
//import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import {generateSnoowrapEntityFromRedditThing, parseRedditFullname} from "../../util";
import Snoowrap from "snoowrap";

export interface ModUserNoteRaw {
    note: string | null
    reddit_id: string | null
    label: string | null
}

export class ModUserNote {
    note?: string
    actedOn?: RedditUser | Submission | Comment | PrivateMessage
    label?: ModUserNoteLabel

    constructor(data: ModUserNoteRaw | undefined, client: Snoowrap) {
        const {
            note,
            reddit_id,
            label
        } = data || {};
        this.note = note !== null ? note : undefined;
        this.label = label !== null ? label as ModUserNoteLabel : undefined;

        if(reddit_id !== null && reddit_id !== undefined) {
            const thing = parseRedditFullname(reddit_id);
            if(thing !== undefined) {
                this.actedOn = generateSnoowrapEntityFromRedditThing(thing, client) as RedditUser | Submission | Comment;
            }
        }
    }
}

export default ModUserNote;
