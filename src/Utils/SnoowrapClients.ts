import Snoowrap, {Listing, RedditUser} from "snoowrap";
import {Submission, Subreddit, Comment} from "snoowrap/dist/objects";
import {parseSubredditName} from "../util";

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

export type ModNoteLabel = 'BOT_BAN' | 'PERMA_BAN' | 'BAN' | 'ABUSE_WARNING' | 'SPAM_WARNING' | 'SPAM_WATCH' | 'SOLID_CONTRIBUTOR' | 'HELPFUL_USER';

export interface ModNoteData {
    user: RedditUser
    subreddit: Subreddit
    activity?: Submission | Comment
    label?: ModNoteLabel
    note: string
}

export class ExtendedSnoowrap extends Snoowrap {
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

    async addModNote(data: ModNoteData): Promise<any> {
        const {note, label} = data;
        const userId = await data.user.id;
        const requestData: any = {
            note,
            label,
            subreddit_id: await data.subreddit.name,
            user_id: `t2_${userId}`,
        }
        if(data.activity !== undefined) {
            requestData.reddit_id = await data.activity.name;
        }

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
