import {Submission, RedditUser, Comment, Subreddit, PrivateMessage} from "snoowrap/dist/objects"
import {generateSnoowrapEntityFromRedditThing, parseRedditFullname} from "../../util"
import Snoowrap from "snoowrap";
import {ModerationActionType} from "../../Common/Infrastructure/Atomic";

//import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";

export interface ModActionRaw {
    action?: ModerationActionType | null
    reddit_id?: string | null
    details?: string | null
    description?: string | null
}

export interface ModActionRawNormalized extends ModActionRaw {
    createdBy?: RedditUser | Subreddit
    subreddit: Subreddit
}

export interface ModLogRaw {
    id: string
    mod_id36: string // wtf
    mod: string // name of moderator that performed the action
    target_fullname: string // ThingID IE t3_wuywlr
    target_author: string
    details: string // flair_edit
    action: ModerationActionType
    description: string
    target_body: string
    subreddit_name_prefixed: string
    subreddit: Subreddit // proxy object
    created_utc: number
}

export class ModAction {
    action?: ModerationActionType
    actedOn?: RedditUser | Submission | Comment | Subreddit | PrivateMessage
    details?: string
    description?: string
    createdBy?: RedditUser | Subreddit
    subreddit?: Subreddit

    constructor(data: ModActionRawNormalized | ModLogRaw | undefined, client: Snoowrap, subreddit?: Subreddit) {
        if(data !== undefined) {
            const {
                action,
                details,
                description
            } = data || {};

            if(subreddit !== undefined) {
                this.subreddit = subreddit;
            }

            if(asModActionRaw(data)) {
                const {
                    reddit_id,
                    createdBy,
                    subreddit: subFromData
                } = data as ModActionRawNormalized || {};

                this.createdBy = createdBy;
                if(this.subreddit === undefined) {
                    this.subreddit = subFromData;
                }

                if (reddit_id !== null && reddit_id !== undefined) {
                    const thing = parseRedditFullname(reddit_id);
                    if (thing !== undefined) {
                        this.actedOn = generateSnoowrapEntityFromRedditThing(thing, client);
                    }
                }
            } else {
                const {
                    target_fullname,
                    target_author,
                    mod,
                    mod_id36,
                    subreddit: subFromData
                } = data || {};

                if (target_fullname !== null && target_fullname !== undefined) {
                    const thing = parseRedditFullname(target_fullname);
                    if (thing !== undefined) {
                        this.actedOn = generateSnoowrapEntityFromRedditThing(thing, client);
                        if (this.actedOn instanceof RedditUser) {
                            this.actedOn.name = target_author;
                        }
                    }
                }

                const author = parseRedditFullname(`t2_${mod_id36}`);
                if(author !== undefined) {
                    this.createdBy = generateSnoowrapEntityFromRedditThing(author, client) as RedditUser;
                    if (this.createdBy instanceof RedditUser) {
                        this.createdBy.name = mod;
                    }
                }
                if(this.subreddit === undefined) {
                    this.subreddit = subFromData;
                }
            }

            this.action = action !== null ? action : undefined;
            this.details = details !== null ? details : undefined;
            this.description = description !== null ? description : undefined;
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

export const asModActionRaw = (data: any): data is ModActionRaw => {
    return data !== null && 'reddit_id' in data;
}

export default ModAction;
