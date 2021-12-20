import Snoowrap, {Listing} from "snoowrap";
import {Subreddit} from "snoowrap/dist/objects";
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
            } catch (err) {
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
