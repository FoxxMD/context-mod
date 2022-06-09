import {Submission, RedditUser, Comment, Subreddit, PrivateMessage} from "snoowrap/dist/objects"
import {generateSnoowrapEntityFromRedditThing, parseRedditFullname} from "../../util"
import Snoowrap from "snoowrap";

//import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";

export interface ModActionRaw {
    action?: string | null
    reddit_id?: string | null
    details?: string | null
    description?: string | null
}

export class ModAction {
    action?: string
    actedOn?: RedditUser | Submission | Comment | Subreddit | PrivateMessage
    details?: string
    description?: string

    constructor(data: ModActionRaw | undefined, client: Snoowrap) {
        const {
            action,
            reddit_id,
            details,
            description
        } = data || {};
        this.action = action !== null ? action : undefined;
        this.details = details !== null ? details : undefined;
        this.description = description !== null ? description : undefined;

        if (reddit_id !== null && reddit_id !== undefined) {
            const thing = parseRedditFullname(reddit_id);
            if (thing !== undefined) {
                this.actedOn = generateSnoowrapEntityFromRedditThing(thing, client);
            }
        }
    }

    toRaw(): ModActionRaw {
        return {
            action: this.action,
            details: this.details,
            reddit_id: this.actedOn !== undefined ? this.actedOn.id : undefined,
            description: this.description
        }
    }

    toJSON() {
        return this.toRaw();
    }
}

export default ModAction;
