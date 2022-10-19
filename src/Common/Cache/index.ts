import {CacheProvider} from "../Infrastructure/Atomic";
import {CacheOptions, StrongTTLConfig} from "../interfaces";
import {cacheOptDefaults} from "../defaults";
import cacheManager, {Cache, CachingConfig, WrapArgsType} from "cache-manager";
import redisStore from "cache-manager-redis-store";
import {create as createMemoryStore} from "../../Utils/memoryStore";
import winston, {Logger} from "winston";
import {mergeArr, parseStringToRegex, redisScanIterator} from "../../util";
import globrex from "globrex";
import objectHash from "object-hash";

export const buildCacheOptionsFromProvider = (provider: CacheProvider | any): CacheOptions => {
    if (typeof provider === 'string') {
        return {
            store: provider as CacheProvider,
            ...cacheOptDefaults
        }
    }
    return {
        store: 'memory',
        ...cacheOptDefaults,
        ...provider,
    }
}
export const createCacheManager = (options: CacheOptions): Cache => {
    const {store, max, ttl = 60, host = 'localhost', port, auth_pass, db, prefix, ...rest} = options;
    switch (store) {
        case 'none':
            return cacheManager.caching({store: 'none', max, ttl});
        case 'redis':
            return cacheManager.caching({
                store: redisStore,
                host,
                port,
                auth_pass,
                db,
                ttl,
                ...rest,
            });
        case 'memory':
        default:
            //return cacheManager.caching({store: 'memory', max, ttl});
            return cacheManager.caching({store: {create: createMemoryStore}, max, ttl, shouldCloneBeforeSet: false});
    }
}

export class CMCache {
    pruneInterval?: any;
    prefix?: string
    cache: Cache
    isDefaultCache: boolean
    providerOptions: CacheOptions;
    logger!: Logger;

    constructor(cache: Cache, providerOptions: CacheOptions, defaultCache: boolean, ttls: Partial<StrongTTLConfig>, logger: Logger) {
        this.cache = cache;
        this.providerOptions = providerOptions
        this.isDefaultCache = defaultCache;
        this.prefix = this.providerOptions.prefix ?? '';

        this.setLogger(logger);

        this.setPruneInterval(ttls);
    }

    setLogger(logger: Logger) {
        this.logger = logger.child({labels: ['Cache']}, mergeArr);
    }

    equalProvider(candidate: CacheOptions) {
        return objectHash.sha1(candidate) === objectHash.sha1(this.providerOptions);
    }

    setPruneInterval(ttls: Partial<StrongTTLConfig>) {
        if (this.providerOptions.store === 'memory' && !this.isDefaultCache) {
            if (this.pruneInterval !== undefined) {
                clearInterval(this.pruneInterval);
            }
            const min = Math.min(60, ...Object.values(ttls).filter(x => typeof x === 'number' && x !== 0) as number[]);
            if (min > 0) {
                // set default prune interval
                this.pruneInterval = setInterval(() => {
                    // @ts-ignore
                    this.cache?.store.prune();
                    this.logger.debug('Pruned cache');
                    // prune interval should be twice the smallest TTL
                }, min * 1000 * 2)
            }
        }
    }

    async getCacheKeyCount() {
        if (this.cache.store.keys !== undefined) {
            if (this.providerOptions.store === 'redis') {
                const keys = await this.cache.store.keys(`${this.prefix}*`);
                return keys.length;
            }
            return (await this.cache.store.keys()).length;
        }
        return 0;
    }

    async interactWithCacheByKeyPattern(pattern: string | RegExp, action: 'get' | 'delete') {
        let patternIsReg = pattern instanceof RegExp;
        let regPattern: RegExp;
        let globPattern = pattern;

        const cacheDict: Record<string, any> = {};

        if (typeof pattern === 'string') {
            const possibleRegPattern = parseStringToRegex(pattern, 'ig');
            if (possibleRegPattern !== undefined) {
                regPattern = possibleRegPattern;
                patternIsReg = true;
            } else {
                if (this.prefix !== undefined && !pattern.includes(this.prefix)) {
                    // need to add wildcard to beginning of pattern so that the regex will still match a key with a prefix
                    globPattern = `${this.prefix}${pattern}`;
                }
                // @ts-ignore
                const result = globrex(globPattern, {flags: 'i'});
                regPattern = result.regex;
            }
        } else {
            regPattern = pattern;
        }

        if (this.providerOptions.store === 'redis') {
            // @ts-ignore
            const redisClient = this.cache.store.getClient();
            if (patternIsReg) {
                // scan all and test key by regex
                for await (const key of redisClient.scanIterator()) {
                    if (regPattern.test(key) && (this.prefix === undefined || key.includes(this.prefix))) {
                        if (action === 'delete') {
                            await redisClient.del(key)
                        } else {
                            cacheDict[key] = await redisClient.get(key);
                        }
                    }
                }
            } else {
                // not a regex means we can use glob pattern (more efficient!)
                for await (const key of redisScanIterator(redisClient, {MATCH: globPattern})) {
                    if (action === 'delete') {
                        await redisClient.del(key)
                    } else {
                        cacheDict[key] = await redisClient.get(key);
                    }
                }
            }
        } else if (this.cache.store.keys !== undefined) {
            for (const key of await this.cache.store.keys()) {
                if (regPattern.test(key) && (this.prefix === undefined || key.includes(this.prefix))) {
                    if (action === 'delete') {
                        await this.cache.del(key)
                    } else {
                        cacheDict[key] = await this.cache.get(key);
                    }
                }
            }
        }
        return cacheDict;
    }

    async deleteCacheByKeyPattern(pattern: string | RegExp) {
        return await this.interactWithCacheByKeyPattern(pattern, 'delete');
    }

    async getCacheByKeyPattern(pattern: string | RegExp) {
        return await this.interactWithCacheByKeyPattern(pattern, 'get');
    }

    get store() {
        return this.cache.store;
    }

    del(key: string): Promise<any> {
        return this.cache.del(`${this.prefix}${key}`);
    }

    get<T>(key: string): Promise<T | undefined> {
        return this.cache.get(`${this.prefix}${key}`);
    }

    reset(): Promise<void> {
        return this.cache.reset();
    }

    set<T>(key: string, value: T, options?: CachingConfig): Promise<T> {
        return this.cache.set(`${this.prefix}${key}`, value, options);
    }

    wrap<T>(...args: WrapArgsType<T>[]): Promise<T> {
        args[0] = `${this.prefix}${args[0]}`;
        return this.cache.wrap(...args);
    }

    async destroy() {
        if (this.pruneInterval !== undefined && this.providerOptions.store === 'memory' && !this.isDefaultCache) {
            clearInterval(this.pruneInterval);
            this.cache?.reset();
        }
    }
}
