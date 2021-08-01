import Snoowrap, {RedditUser, Comment, Submission} from "snoowrap";
import objectHash from 'object-hash';
import {
    AuthorActivitiesOptions,
    AuthorTypedActivitiesOptions, BOT_LINK,
    getAuthorActivities, singleton,
    testAuthorCriteria
} from "../Utils/SnoowrapUtils";
import Subreddit from 'snoowrap/dist/objects/Subreddit';
import winston, {Logger} from "winston";
import fetch from 'node-fetch';
import {
    buildCacheOptionsFromProvider,
    cacheStats, createCacheManager,
    formatNumber,
    mergeArr,
    parseExternalUrl,
    parseWikiContext
} from "../util";
import LoggedError from "../Utils/LoggedError";
import {
    CacheOptions,
    Footer, OperatorConfig, ResourceStats,
    SubredditCacheConfig, TTLConfig
} from "../Common/interfaces";
import UserNotes from "./UserNotes";
import Mustache from "mustache";
import he from "he";
import {AuthorCriteria} from "../Author/Author";
import {SPoll} from "./Streams";
import {Cache} from 'cache-manager';

export const DEFAULT_FOOTER = '\r\n*****\r\nThis action was performed by [a bot.]({{botLink}}) Mention a moderator or [send a modmail]({{modmailLink}}) if you any ideas, questions, or concerns about this action.';

export interface SubredditResourceConfig extends Footer {
    caching?: SubredditCacheConfig,
    subreddit: Subreddit,
    logger: Logger;
}

interface SubredditResourceOptions extends Footer {
    ttl: Required<TTLConfig>
    cache?: Cache
    cacheType: string;
    cacheSettingsHash: string
    subreddit: Subreddit,
    logger: Logger;
}

export interface SubredditResourceSetOptions extends SubredditCacheConfig, Footer {
}

export class SubredditResources {
    //enabled!: boolean;
    protected authorTTL!: number;
    protected useSubredditAuthorCache!: boolean;
    protected wikiTTL!: number;
    name: string;
    protected logger: Logger;
    userNotes: UserNotes;
    footer: false | string = DEFAULT_FOOTER;
    subreddit: Subreddit
    cache?: Cache
    cacheType: string
    cacheSettingsHash?: string;
    pruneInterval?: any;

    stats: { cache: ResourceStats };

    constructor(name: string, options: SubredditResourceOptions) {
        const {
            subreddit,
            logger,
            ttl: {
                userNotesTTL,
                authorTTL,
                wikiTTL,
            },
            cache,
            cacheType,
            cacheSettingsHash,
        } = options || {};

        this.cacheSettingsHash = cacheSettingsHash;
        this.cache = cache;
        this.cacheType = cacheType;
        this.authorTTL = authorTTL;
        this.wikiTTL = wikiTTL;
        this.subreddit = subreddit;
        this.name = name;
        if (logger === undefined) {
            const alogger = winston.loggers.get('default')
            this.logger = alogger.child({labels: [this.name, 'Resource Cache']}, mergeArr);
        } else {
            this.logger = logger.child({labels: ['Resource Cache']}, mergeArr);
        }

        this.stats = {
            cache: cacheStats()
        };

        const cacheUseCB = (miss: boolean) => {
            this.stats.cache.userNotes.requests++;
            this.stats.cache.userNotes.miss += miss ? 1 : 0;
        }
        this.userNotes = new UserNotes(userNotesTTL, this.subreddit, this.logger, this.cache, cacheUseCB)

        if(this.cacheType === 'memory' && this.cacheSettingsHash !== 'default') {
            const min = Math.min(...([wikiTTL, authorTTL, userNotesTTL].filter(x => x !== 0)));
            if(min > 0) {
                // set default prune interval
                this.pruneInterval = setInterval(() => {
                    // @ts-ignore
                    this.defaultCache?.store.prune();
                    this.logger.debug('Pruned cache');
                    // prune interval should be twice the smallest TTL
                },min * 1000 * 2)
            }
        }
    }

    async getCacheKeyCount() {
        if (this.cache !== undefined && this.cache.store.keys !== undefined) {
            return (await this.cache.store.keys()).length;
        }
        return 0;
    }

    getStats() {
        return {
            cache: {
                // TODO could probably combine these two
                totalRequests: Object.values(this.stats.cache).reduce((acc, curr) => acc + curr.requests, 0),
                types: Object.keys(this.stats.cache).reduce((acc, curr) => {
                    const per = acc[curr].miss === 0 ? 0 : formatNumber(acc[curr].miss / acc[curr].requests) * 100;
                    // @ts-ignore
                    acc[curr].missPercent = `${formatNumber(per, {toFixed: 0})}%`;
                    return acc;
                }, this.stats.cache)
            }
        }
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
            this.stats.cache.content.requests++;
            const cachedContent = await this.cache.get(hash);
            if (cachedContent !== undefined) {
                this.logger.debug(`Cache Hit: ${cacheKey}`);
                return cachedContent as string;
            } else {
                this.stats.cache.content.miss++;
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
                const client = singleton.getClient();
                sub = client.getSubreddit(wikiContext.subreddit);
            }
            try {
                // @ts-ignore
                const wikiPage = sub.getWikiPage(wikiContext.wiki);
                wikiContent = await wikiPage.content_md;
            } catch (err) {
                let msg = `Could not read wiki page for an unknown reason. Please ensure the page 'https://reddit.com${sub.display_name_prefixed}/wiki/${wikiContext.wiki}' exists and is readable`;
                if(err.statusCode !== undefined) {
                    if(err.statusCode === 404) {
                        msg = `Could not find a wiki page at https://reddit.com${sub.display_name_prefixed}/wiki/${wikiContext.wiki} -- Reddit returned a 404`;
                    } else if(err.statusCode === 403 || err.statusCode === 401) {
                        msg = `Bot either does not have permission visibility permissions for the wiki page at https://reddit.com${sub.display_name_prefixed}wiki/${wikiContext.wiki} (due to subreddit restrictions) or the bot does have have oauth permissions to read wiki pages (operator error). Reddit returned a ${err.statusCode}`;
                    }
                }
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
            this.cache.set(hash, wikiContent, {ttl: this.wikiTTL});
        }

        return wikiContent;
    }

    async testAuthorCriteria(item: (Comment | Submission), authorOpts: AuthorCriteria, include = true) {
        if (this.cache !== undefined && this.authorTTL > 0) {
            const hashObj = {itemId: item.id, ...authorOpts, include};
            const hash = `authorCrit-${objectHash.sha1(hashObj)}`;
            this.stats.cache.authorCrit.requests++;
            let miss = false;
            const cachedAuthorTest = await this.cache.wrap(hash, async () => {
                miss = true;
                return await testAuthorCriteria(item, authorOpts, include, this.userNotes);
            }, {ttl: this.authorTTL});
            if (!miss) {
                this.logger.debug(`Cache Hit: Author Check on ${item.id}`);
            } else {
                this.stats.cache.authorCrit.miss++;
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

class SubredditResourcesManager {
    resources: Map<string, SubredditResources> = new Map();
    authorTTL: number = 10000;
    enabled: boolean = true;
    modStreams: Map<string, SPoll<Snoowrap.Submission | Snoowrap.Comment>> = new Map();
    defaultCache?: Cache;
    cacheType: string = 'none';
    cacheHash!: string;
    ttlDefaults!: Required<TTLConfig>;
    pruneInterval: any;

    setDefaultsFromConfig(config: OperatorConfig) {
        const {
            caching: {
                authorTTL,
                userNotesTTL,
                wikiTTL,
                provider,
            },
            caching,
        } = config;
        this.cacheHash = objectHash.sha1(caching);
        this.setTTLDefaults({authorTTL, userNotesTTL, wikiTTL});
        this.setDefaultCache(provider);
    }

    setDefaultCache(options: CacheOptions) {
        this.cacheType = options.store;
        this.defaultCache = createCacheManager(options);
        if(this.cacheType === 'memory') {
            const min = Math.min(...([this.ttlDefaults.wikiTTL, this.ttlDefaults.authorTTL, this.ttlDefaults.userNotesTTL].filter(x => x !== 0)));
            if(min > 0) {
                // set default prune interval
                this.pruneInterval = setInterval(() => {
                    // @ts-ignore
                    this.defaultCache?.store.prune();
                    // kinda hacky but whatever
                    const logger = winston.loggers.get('default');
                    logger.debug('Pruned Shared Cache');
                    // prune interval should be twice the smallest TTL
                },min * 1000 * 2)
            }
        }
    }

    setTTLDefaults(def: Required<TTLConfig>) {
        this.ttlDefaults = def;
    }

    get(subName: string): SubredditResources | undefined {
        if (this.resources.has(subName)) {
            return this.resources.get(subName) as SubredditResources;
        }
        return undefined;
    }

    set(subName: string, initOptions: SubredditResourceConfig): SubredditResources {
        let hash = 'default';
        const { caching, ...init } = initOptions;

        let opts: SubredditResourceOptions = {
            cache: this.defaultCache,
            cacheType: this.cacheType,
            cacheSettingsHash: hash,
            ttl: this.ttlDefaults,
            ...init,
        };

        if(caching !== undefined) {
            const {provider = 'memory', ...rest} = caching;
            let cacheConfig = {
                provider: buildCacheOptionsFromProvider(provider),
                ttl: {
                    ...this.ttlDefaults,
                    ...rest
                },
            }
            hash = objectHash.sha1(cacheConfig);
            // only need to create private if there settings are actually different than the default
            if(hash !== this.cacheHash) {
                const {provider: trueProvider, ...trueRest} = cacheConfig;
                opts = {
                    cache: createCacheManager(trueProvider),
                    cacheType: trueProvider.store,
                    cacheSettingsHash: hash,
                    ...init,
                    ...trueRest,
                };
            }
        }

        let resource: SubredditResources;
        const res = this.get(subName);
        if(res === undefined || res.cacheSettingsHash !== hash) {
            if(res !== undefined && res.cache !== undefined) {
                res.cache.reset();
            }
            resource = new SubredditResources(subName, opts);
            this.resources.set(subName, resource);
        } else {
            // just set non-cache related settings
            resource = res;
            if(opts.footer !== resource.footer) {
                resource.footer = opts.footer || DEFAULT_FOOTER;
            }
            // reset cache stats when configuration is reloaded
            resource.stats.cache = cacheStats();
        }

        return resource;
    }
}

const manager = new SubredditResourcesManager();

export default manager;
