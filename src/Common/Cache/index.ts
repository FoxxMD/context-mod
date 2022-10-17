import {CacheOptions} from "../interfaces";
import cacheManager, {Cache} from "cache-manager";
import {redisStore} from "cache-manager-redis-store";
import {create as createMemoryStore} from "../../Utils/memoryStore";
import {CacheProvider} from "../Infrastructure/Atomic";
import {cacheOptDefaults} from "../defaults";

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
export const createCacheManager = async (options: CacheOptions): Promise<Cache> => {
    const {store, max, ttl = 60, host = 'localhost', port, auth_pass, db, ...rest} = options;
    switch (store) {
        case 'none':
            return cacheManager.caching({store: 'none', max, ttl});
        case 'redis':
            const rStore = await redisStore(
                {
                    socket: {
                        host,
                        port
                    },
                    password: auth_pass,
                    database: db,
                }
            );
            return cacheManager.caching({
                store: rStore,
                ttl,
                ...rest,
            });
        case 'memory':
        default:
            //return cacheManager.caching({store: 'memory', max, ttl});
            return cacheManager.caching({store: {create: createMemoryStore}, max, ttl, shouldCloneBeforeSet: false});
    }
}
