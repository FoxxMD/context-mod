import Snoowrap from "snoowrap";

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

export class RequestTrackingSnoowrap extends Snoowrap {
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
