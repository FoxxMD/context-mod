import Snoowrap, {Listing, RedditUser} from "snoowrap";
import {Submission, Subreddit, Comment} from "snoowrap/dist/objects";
import {parseSubredditName} from "../util";
import {ModUserNoteLabel} from "../Common/Infrastructure/Atomic";
import {ModNote, ModNoteRaw} from "../Subreddit/ModNotes/ModNote";

// const proxyFactory = (endpoint: string) => {
//     return class ProxiedSnoowrap extends Snoowrap {
//         rawRequest(options: any) {
//             // send all requests through a proxy
//             return super.rawRequest(Object.assign(options, {
//                 proxy: endpoint,
//                 tunnel: false
//             }))
//         }
//     }
// }

export interface ModNoteData {
    user: RedditUser
    subreddit: Subreddit
    activity?: Submission | Comment
    label?: ModUserNoteLabel
    note: string
}

export interface ModNoteGetOptions {
    before?: string,
    filter?: ModUserNoteLabel,
    limit?: number
}

export interface ModNotesRaw {
    mod_notes: ModNoteRaw[]
    start_cursor: string
    end_cursor: string
    has_next_page: boolean
}

export interface ModNotesResponse {
    notes: ModNote[]
    startCursor: string
    endCursor: string
    isFinished: boolean
}

export class ExtendedSnoowrap extends Snoowrap {

    constructor(args: any) {
        super(args);
        const {timeoutCodes = ['ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNRESET']} = args;
        // @ts-ignore
        this._config.timeoutCodes = timeoutCodes;
    }

    /**
     * https://www.reddit.com/r/redditdev/comments/jfltfx/comment/g9le48w/?utm_source=reddit&utm_medium=web2x&context=3
     * */
    async getManySubreddits(subs: (Subreddit | string)[]): Promise<Listing<Subreddit>> {
        // parse all names
        const names = subs.map(x => {
            if(typeof x !== 'string') {
                return x.display_name;
            }
            try {
                return parseSubredditName(x);
            } catch (err: any) {
                return x;
            }
        });

        return await this.oauthRequest({uri: '/api/info', method: 'get', qs: { sr_name: names.join(',')}}) as Listing<Subreddit>;
    }

    async assignUserFlairByTemplateId(options: { flairTemplateId: string, username: string, subredditName: string }): Promise<any> {
        return await this.oauthRequest({
            uri: `/r/${options.subredditName}/api/selectflair`,
            method: 'post',
            form: {
                api_type: 'json',
                name: options.username,
                flair_template_id: options.flairTemplateId,
            }
        });
    }

    async getModNotes(subreddit: Subreddit, user: RedditUser, options: ModNoteGetOptions = {}): Promise<ModNotesResponse> {
        const data: any = {
            subreddit: subreddit.display_name,
            user: user.name,
            ...options
        };
        const response = await this.oauthRequest({
            uri: `/api/mod/notes`,
            method: 'get',
            qs: data
        }) as ModNotesRaw;
        return {
            notes: response.mod_notes.map(x => new ModNote(x, this)),
            startCursor: response.start_cursor,
            endCursor: response.end_cursor,
            isFinished: !response.has_next_page
        }
    }

    /**
     * Add a Mod Note
     *
     * @see https://www.reddit.com/dev/api#POST_api_mod_notes
     * */
    async addModNote(data: ModNoteData): Promise<ModNote> {
        const {note, label} = data;

        const requestData: any = {
            note,
            label,
            subreddit: await data.subreddit.display_name,
            user: data.user.name,
        }
        if(data.activity !== undefined) {
            requestData.reddit_id = await data.activity.name;
        }

        const response =await this.oauthRequest({
            uri: `/api/mod/notes`,
            method: 'post',
            form: requestData
        }) as ModNoteRaw;
        return new ModNote(response, this);
    }
}

export class RequestTrackingSnoowrap extends ExtendedSnoowrap {
    requestCount: number = 0;

    oauthRequest(...args: any) {
        // send all requests through a proxy
        if(args[1] === undefined || args[1] === 1) {
            this.requestCount++;
        }
        // @ts-ignore
        return super.oauthRequest(...args);
    }
}

export class ProxiedSnoowrap extends RequestTrackingSnoowrap {
    proxyEndpoint: string;

    constructor(args: any) {
        super(args);
        const {proxy} = args;
        this.proxyEndpoint = proxy;
    }

    rawRequest(options: any) {
        // send all requests through a proxy
        return super.rawRequest(Object.assign(options, {
            proxy: this.proxyEndpoint,
            tunnel: false
        }))
    }
}
