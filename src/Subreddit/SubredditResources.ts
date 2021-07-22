import Snoowrap, {RedditUser, Comment, Submission} from "snoowrap";
import cache from 'memory-cache';
import objectHash from 'object-hash';
import {
    AuthorActivitiesOptions,
    AuthorTypedActivitiesOptions, BOT_LINK,
    getAuthorActivities,
    testAuthorCriteria
} from "../Utils/SnoowrapUtils";
import Subreddit from 'snoowrap/dist/objects/Subreddit';
import winston, {Logger} from "winston";
import fetch from 'node-fetch';
import {mergeArr, parseExternalUrl, parseWikiContext} from "../util";
import LoggedError from "../Utils/LoggedError";
import {
    CacheOptions, CacheProvider,
    Footer, OperatorConfig, ResourceStats,
    StrongCache,
    StrongSubredditCacheConfig,
    SubredditCacheConfig
} from "../Common/interfaces";
import UserNotes from "./UserNotes";
import Mustache from "mustache";
import he from "he";
import {AuthorCriteria} from "../Author/Author";
import Poll from "snoostorm/out/util/Poll";
import {SPoll} from "./Streams";
import cacheManager, {Cache} from 'cache-manager';
import redisStore from 'cache-manager-redis-store';

export const DEFAULT_FOOTER = '\r\n*****\r\nThis action was performed by [a bot.]({{botLink}}) Mention a moderator or [send a modmail]({{modmailLink}}) if you any ideas, questions, or concerns about this action.';

export interface SubredditResourceOptions extends SubredditCacheConfig, Footer {
    enabled: boolean;
    subreddit: Subreddit,
    logger: Logger;
}

interface StrongSubredditResourceOptions extends SubredditResourceOptions {
    cache?: Cache
}

export interface SubredditResourceSetOptions extends SubredditCacheConfig, Footer {
    enabled: boolean,
}


//
// interface ResourceStats {
//     cache: {
//         //keys: number,
//         author: {
//             requests: number,
//             miss: number,
//         },
//         authorCrit: {
//             requests: number,
//             miss: number,
//         }
//         content: {
//             requests: number,
//             miss: number,
//         }
//     }
// }



export class SubredditResources {
    //enabled!: boolean;
    protected authorTTL!: number;
    protected useSubredditAuthorCache!: boolean;
    protected wikiTTL!: number;
    name: string;
    protected logger: Logger;
    userNotes: UserNotes;
    footer!: false | string;
    subreddit: Subreddit
    cache?: Cache

    stats: { cache: ResourceStats };

    constructor(name: string, options: StrongSubredditResourceOptions) {
        const {
            subreddit,
            logger,
            enabled = true,
            userNotesTTL = 60000,
            cache,
        } = options || {};

        this.cache = cache;
        this.subreddit = subreddit;
        this.name = name;
        if (logger === undefined) {
            const alogger = winston.loggers.get('default')
            this.logger = alogger.child({labels: [this.name, 'Resource Cache']}, mergeArr);
        } else {
            this.logger = logger.child({labels: ['Resource Cache']}, mergeArr);
        }

        this.stats = {
            cache: {
                author: {
                    requests: 0,
                    miss: 0,
                },
                authorCrit: {
                    requests: 0,
                    miss: 0,
                },
                content: {
                    requests: 0,
                    miss: 0
                }
            }
        };

        this.userNotes = new UserNotes(enabled ? userNotesTTL : 0, this.subreddit, this.logger)
        this.setOptions(options);
    }

    setOptions(options: SubredditResourceSetOptions) {
        const {
            authorTTL,
            userNotesTTL,
            wikiTTL,
            footer = DEFAULT_FOOTER
        } = options || {};

        this.footer = footer;
        if (authorTTL === undefined) {
            this.useSubredditAuthorCache = false;
            this.authorTTL = manager.authorTTL;
        } else {
            this.useSubredditAuthorCache = true;
            this.authorTTL = authorTTL;
        }
        this.wikiTTL = wikiTTL || this.wikiTTL;
        this.userNotes.notesTTL = userNotesTTL || this.userNotes.notesTTL;
    }

    async getCacheKeyCount() {
        if (this.cache !== undefined && this.cache.store.keys !== undefined) {
            return (await this.cache.store.keys()).length;
        }
        return 0;
    }

    async getAuthorActivities(user: RedditUser, options: AuthorTypedActivitiesOptions): Promise<Array<Submission | Comment>> {
        if (this.cache !== undefined && this.authorTTL > 0) {
            const userName = user.name;
            const hashObj: any = {...options, userName};
            if (this.useSubredditAuthorCache) {
                hashObj.subreddit = this.name;
            }
            const hash = objectHash.sha1({...options, userName});

            this.stats.cache.author.requests++;
            let miss = false;
            const cacheVal = await this.cache.wrap(hash, async () => {
                miss = true;
                return await getAuthorActivities(user, options);
            }, {ttl: this.authorTTL});
            if (!miss) {
                this.logger.debug(`Cache Hit: ${userName} (${options.type || 'overview'})`);
            } else {
                this.stats.cache.author.miss++;
            }
            return cacheVal as Array<Submission | Comment>;
        }
        return await getAuthorActivities(user, options);
    }

    async getAuthorComments(user: RedditUser, options: AuthorActivitiesOptions): Promise<Comment[]> {
        return await this.getAuthorActivities(user, {...options, type: 'comment'}) as unknown as Promise<Comment[]>;
    }

    async getAuthorSubmissions(user: RedditUser, options: AuthorActivitiesOptions): Promise<Submission[]> {
        return await this.getAuthorActivities(user, {
            ...options,
            type: 'submission'
        }) as unknown as Promise<Submission[]>;
    }

    async getContent(val: string, subredditArg?: Subreddit): Promise<string> {
        const subreddit = subredditArg || this.subreddit;
        let cacheKey;
        const wikiContext = parseWikiContext(val);
        if (wikiContext !== undefined) {
            cacheKey = `${wikiContext.wiki}${wikiContext.subreddit !== undefined ? `|${wikiContext.subreddit}` : ''}`;
        }
        const extUrl = wikiContext === undefined ? parseExternalUrl(val) : undefined;
        if (extUrl !== undefined) {
            cacheKey = extUrl;
        }

        if (cacheKey === undefined) {
            return val;
        }

        // try to get cached value first
        let hash = `${subreddit.display_name}-${cacheKey}`;
        if (this.cache !== undefined && this.wikiTTL > 0) {
            const cachedContent = await this.cache.get(hash);
            if (cachedContent !== null) {
                this.logger.debug(`Cache Hit: ${cacheKey}`);
                return cachedContent as string;
            }
        }

        let wikiContent: string;

        // no cache hit, get from source
        if (wikiContext !== undefined) {
            let sub;
            if (wikiContext.subreddit === undefined || wikiContext.subreddit.toLowerCase() === subreddit.display_name) {
                sub = subreddit;
            } else {
                // @ts-ignore
                const client = subreddit._r as Snoowrap;
                sub = client.getSubreddit(wikiContext.subreddit);
            }
            try {
                const wikiPage = sub.getWikiPage(wikiContext.wiki);
                wikiContent = await wikiPage.content_md;
            } catch (err) {
                const msg = `Could not read wiki page. Please ensure the page 'https://reddit.com${sub.display_name_prefixed}wiki/${wikiContext}' exists and is readable`;
                this.logger.error(msg, err);
                throw new LoggedError(msg);
            }
        } else {
            try {
                const response = await fetch(extUrl as string);
                wikiContent = await response.text();
            } catch (err) {
                const msg = `Error occurred while trying to fetch the url ${extUrl}`;
                this.logger.error(msg, err);
                throw new LoggedError(msg);
            }
        }

        if (this.cache !== undefined && this.wikiTTL > 0) {
            this.cache.set(hash, wikiContent, this.wikiTTL);
        }

        return wikiContent;
    }

    async testAuthorCriteria(item: (Comment | Submission), authorOpts: AuthorCriteria, include = true) {
        if (this.cache !== undefined && this.authorTTL > 0) {
            const hashObj = {itemId: item.id, ...authorOpts, include};
            const hash = `authorCrit-${objectHash.sha1(hashObj)}`;
            let miss = false;
            const cachedAuthorTest = await this.cache.wrap(hash, async () => {
                miss = true;
                return await testAuthorCriteria(item, authorOpts, include, this.userNotes);
            }, {ttl: this.authorTTL});
            if (!miss) {
                this.logger.debug(`Cache Hit: Author Check on ${item.id}`);
            }
            return cachedAuthorTest;
        }

        return await testAuthorCriteria(item, authorOpts, include, this.userNotes);
    }

    async generateFooter(item: Submission | Comment, actionFooter?: false | string) {
        let footer = actionFooter !== undefined ? actionFooter : this.footer;
        if (footer === false) {
            return '';
        }
        const subName = await item.subreddit.display_name;
        const permaLink = `https://reddit.com${await item.permalink}`
        const modmailLink = `https://www.reddit.com/message/compose?to=%2Fr%2F${subName}&message=${encodeURIComponent(permaLink)}`

        const footerRawContent = await this.getContent(footer, item.subreddit);
        return he.decode(Mustache.render(footerRawContent, {subName, permaLink, modmailLink, botLink: BOT_LINK}));
    }
}

export const createCacheManager = (options: CacheOptions) => {
    const {store, max, ttl = 60, host = 'localhost', port, auth_pass, db} = options;
    switch (store) {
        case 'none':
            return undefined;
        case 'redis':
            return cacheManager.caching({
                store: redisStore,
                host,
                port,
                auth_pass,
                db,
                ttl
            });
        case 'memory':
        default:
            return cacheManager.caching({store: 'memory', max, ttl});
    }
}

class SubredditResourcesManager {
    resources: Map<string, SubredditResources> = new Map();
    authorTTL: number = 10000;
    enabled: boolean = true;
    modStreams: Map<string, SPoll<Snoowrap.Submission | Snoowrap.Comment>> = new Map();
    defaultCache?: Cache;
    ttlDefaults!: StrongSubredditCacheConfig;

    setDefaultsFromConfig(config: OperatorConfig) {
        const {
            caching: {
                authorTTL,
                userNotesTTL,
                wikiTTL,
                provider,
            },
        } = config;
        this.setDefaultCache(provider);
        this.setTTLDefaults({authorTTL, userNotesTTL, wikiTTL});
    }

    setDefaultCache(options: CacheOptions) {
        this.defaultCache = createCacheManager(options);
    }

    setTTLDefaults(def: StrongSubredditCacheConfig) {
        this.ttlDefaults = def;
    }

    get(subName: string): SubredditResources | undefined {
        if (this.resources.has(subName)) {
            return this.resources.get(subName) as SubredditResources;
        }
        return undefined;
    }

    set(subName: string, initOptions: SubredditResourceOptions): SubredditResources {
        const resource = new SubredditResources(subName, {...this.ttlDefaults, ...initOptions, cache: this.defaultCache});
        this.resources.set(subName, resource);
        return resource;
    }
}

const manager = new SubredditResourcesManager();

export default manager;
