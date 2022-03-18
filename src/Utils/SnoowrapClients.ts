import Snoowrap, {Listing, RedditUser} from "snoowrap";
import {Submission, Subreddit, Comment} from "snoowrap/dist/objects";
import {parseSubredditName} from "../util";
import {ModNoteLabel} from "../Common/types";

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
    label?: ModNoteLabel
    note: string
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

    /**
     * Add a Mod Note
     *
     * @see https://www.reddit.com/dev/api#POST_api_mod_notes
     * */
    async addModNote(data: ModNoteData): Promise<any> {
        const {note, label} = data;

        // can't use label or reddit_id (activity) on POST yet
        // https://www.reddit.com/r/redditdev/comments/t8w861/comment/i0wk46b/?utm_source=reddit&utm_medium=web2x&context=3
        const requestData: any = {
            note,
            //label,
            subreddit: await data.subreddit.display_name,
            user: data.user.name,
        }
        // if(data.activity !== undefined) {
        //     requestData.reddit_id = await data.activity.name;
        // }

        return await this.oauthRequest({
            uri: `/api/mod/notes`,
            method: 'post',
            form: requestData
        });
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
