import {OperatorConfig, OperatorJsonConfig} from "../src/Common/interfaces";
import Snoowrap from "snoowrap";
import Bot from "../src/Bot/index"
import {buildOperatorConfigWithDefaults, insertNameFilters} from "../src/ConfigBuilder";
import {App} from "../src/App";
import {YamlOperatorConfigDocument} from "../src/Common/Config/Operator";
import {NoopLogger} from "../src/Utils/loggerFactory";
import {ManagerEntity} from "../src/Common/Entities/ManagerEntity";
import {Bot as BotEntity} from "../src/Common/Entities/Bot";
import {SubredditResources} from "../src/Subreddit/SubredditResources";
import {Subreddit, Comment, Submission} from 'snoowrap/dist/objects';
import dayjs from 'dayjs';
import {
    FilterOptions, MaybeAnonymousCriteria,
    MinimalOrFullFilter,
    MinimalOrFullFilterJson, MinimalOrFullMaybeAnonymousFilter, NamedCriteria
} from "../src/Common/Infrastructure/Filters/FilterShapes";
import {AuthorCriteria} from "../src";
import {TypedActivityState} from "../src/Common/Infrastructure/Filters/FilterCriteria";

const mockSnoowrap = new Snoowrap({userAgent: 'test', accessToken: 'test'});

const memoryConfig: OperatorJsonConfig = {
    databaseConfig: {
        connection: {
            type: 'sqljs',
            location: ':memory:'
        }
    },
    logging: {
        level: 'debug',
        file: {
            dirname: false
        }
    },
    bots: [
        {
            name: 'test',
            credentials: {
                reddit: {
                    clientId: 'test',
                    clientSecret: 'test',
                    accessToken: 'test',
                    refreshToken: 'test'
                }
            }
        }
    ]
};

let config: OperatorConfig;
let app: App;
let snoowrap: Snoowrap;
let bot: Bot;
let resource: SubredditResources;
let subreddit: Subreddit;

export const getConfig = async () => {
    if (config === undefined) {
        config = await buildOperatorConfigWithDefaults(memoryConfig);
    }
    return config;
}

export const getApp = async () => {
    if (app === undefined) {
        const config = await getConfig();
        app = new App({...config, fileConfig: {document: new YamlOperatorConfigDocument('')}});
        await app.initDatabase();
    }
    return app;
}

export const getSnoowrap = async () => {
    if (snoowrap === undefined) {
        const bot = await getBot();
        snoowrap = bot.client;
    }
    return snoowrap;
}

export const getBot = async () => {
    if (bot === undefined) {
        await getApp();
        const config = await getConfig();
        bot = new Bot(config.bots[0], NoopLogger);
        await bot.cacheManager.set('test', {
            logger: NoopLogger,
            caching: {
                authorTTL: false,
                submissionTTL: false,
                commentTTL: false,
                provider: 'memory'
            },
            subreddit: bot.client.getSubreddit('test'),
            client: bot.client,
            statFrequency: 'minute',
            managerEntity: new ManagerEntity(),
            botEntity: new BotEntity()
        });
    }
    return bot;
}

export const getResource = async () => {
    if (resource === undefined) {
        const bot = await getBot();
        resource = bot.cacheManager.get('test') as SubredditResources;
    }
    return resource;
}

// @ts-ignore
export const getSubreddit = async () => {
    if (subreddit === undefined) {
        const snoo = await getSnoowrap();
        subreddit = new Subreddit({id: 't3_test', name: 'test'}, snoo, true);
    }
    // @ts-ignore
    return subreddit;
}

export const sampleActivity = {
    moddable: {
        commentRemovedByMod: (snoowrap = mockSnoowrap) => {
            return new Submission({
                can_mod_post: true,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed_by_category: 'mod'
            }, snoowrap, true);
        },
        activityRemovedByMod: (snoowrap = mockSnoowrap) => {
            return new Submission({
                can_mod_post: true,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed_by_category: 'mod'
            }, snoowrap, true)
        },
        activityFilteredByAutomod: (snoowrap = mockSnoowrap) => {
            return new Submission({
                can_mod_post: true,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed_by_category: 'automod_filtered'
            }, snoowrap, true);
        },
        commentFiltered: (snoowrap = mockSnoowrap) => {
            return new Comment({
                can_mod_post: true,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed: false,
                replies: ''
            }, snoowrap, true)
        },
        commentRemoved: (snoowrap = mockSnoowrap) => {
            return new Comment({
                can_mod_post: true,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed: true,
                replies: ''
            }, snoowrap, true);
        },
        submissionDeleted: (snoowrap = mockSnoowrap) => {
            return new Submission({
                can_mod_post: true,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed_by_category: 'deleted'
            }, snoowrap, true);
        },
        commentDeleted: (snoowrap = mockSnoowrap) => {
            return new Comment({
                can_mod_post: true,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed: false,
                replies: '',
                author: {
                    name: '[deleted]'
                }
            }, snoowrap, true);
        }
    },
    public: {
        submissionRemoved: (snoowrap = mockSnoowrap) => {
            return new Submission({
                can_mod_post: false,
                removed_by_category: 'moderator'
            }, snoowrap, true)
        },
        submissionDeleted: (snoowrap = mockSnoowrap) => {
            return new Submission({
                can_mod_post: false,
                removed_by_category: 'deleted'
            }, snoowrap, true);
        },
        commentRemoved: (snoowrap = mockSnoowrap) => {
            return new Comment({
                can_mod_post: false,
                body: '[removed]',
                replies: ''
            }, snoowrap, true)
        },
        activityRemoved: (snoowrap = mockSnoowrap) => {
            return new Submission({
                can_mod_post: false,
                banned_at_utc: dayjs().subtract(10, 'minutes').unix(),
                removed_by_category: 'moderator'
            }, snoowrap, true);
        }
    }
}

export const authorAgeDayCrit = (): AuthorCriteria => ({
    age: '> 1 day'
});
export const authorAgeMonthCrit = (): AuthorCriteria => ({
    age: '> 1 month'
});
export const authorFlair1Crit = (): AuthorCriteria => ({
    flairText: 'flair 1'
});
export const authorFlair2Crit = (): AuthorCriteria => ({
    flairText: 'flair 2'
});

export const fullAuthorFullInclude = (): FilterOptions<AuthorCriteria> => ({
    include: [
        {
            criteria: authorAgeDayCrit()
        },
        {
            criteria: authorFlair1Crit()
        }
    ]
})

export const fullAuthorFullExclude = (): FilterOptions<AuthorCriteria> => ({
    exclude: [
        {
            criteria: authorAgeMonthCrit()
        },
        {
            criteria: authorFlair2Crit()
        }
    ]
})

export const fullAuthorFullAll = (): FilterOptions<AuthorCriteria> => ({
    include: fullAuthorFullInclude().include,
})

export const fullAuthorAnonymousInclude = (): MinimalOrFullFilterJson<AuthorCriteria> => ({
    include: [
        authorAgeDayCrit(),
        authorFlair1Crit()
    ]
})
export const fullAuthorAnonymousExclude = (): MinimalOrFullFilterJson<AuthorCriteria> => ({
    exclude: [
        authorAgeMonthCrit(),
        authorFlair2Crit()
    ]
});
export const fullAuthorAnonymousAll = (): MinimalOrFullFilterJson<AuthorCriteria> => ({
    include: (fullAuthorAnonymousInclude() as FilterOptions<AuthorCriteria>).include,
    exclude: (fullAuthorAnonymousExclude() as FilterOptions<AuthorCriteria>).exclude,
})

export const namedAuthorFilter = (): NamedCriteria<AuthorCriteria> => ({
    name: 'test1Author',
    criteria: authorAgeDayCrit()
});

export const itemRemovedCrit = (): TypedActivityState => ({
    removed: false
});
export const itemApprovedCrit = (): TypedActivityState => ({
    approved: true
});
export const itemFlairCrit = (): TypedActivityState => ({
    link_flair_text: ['test1','test2']
});

export const fullItemFullInclude = (): FilterOptions<TypedActivityState> => ({
    include: [
        {
            criteria: itemRemovedCrit()
        },
        {
            criteria: itemApprovedCrit()
        }
    ]
})

export const fullItemFullExclude = (): FilterOptions<TypedActivityState> => ({
    exclude: [
        {
            criteria: itemRemovedCrit()
        },
        {
            criteria: itemFlairCrit()
        }
    ]
})

export const fullItemFullAll = (): FilterOptions<TypedActivityState> => ({
    include: fullItemFullInclude().include,
})

export const fullItemAnonymousInclude = (): MinimalOrFullFilterJson<TypedActivityState> => ({
    include: [
        itemRemovedCrit(),
        itemApprovedCrit()
    ]
})
export const fullItemAnonymousExclude = (): MinimalOrFullFilterJson<TypedActivityState> => ({
    exclude: [
        itemRemovedCrit(),
        itemFlairCrit()
    ]
});
export const fullItemAnonymousAll = (): MinimalOrFullFilterJson<TypedActivityState> => ({
    include: (fullItemAnonymousInclude() as FilterOptions<TypedActivityState>).include,
    exclude: (fullItemAnonymousExclude() as FilterOptions<TypedActivityState>).exclude,
})

export const namedItemFilter = (): NamedCriteria<TypedActivityState> => ({
    name: 'test1Item',
    criteria: itemRemovedCrit()
});

export const namedAuthorFilters = new Map([['test1author', namedAuthorFilter()]]);
export const namedItemFilters = new Map([['test1item', namedItemFilter()]]);

export const minimalAuthorFilter = (): MinimalOrFullMaybeAnonymousFilter<AuthorCriteria> => ([
    {
        criteria: authorAgeDayCrit()
    },
    {
        criteria: authorAgeMonthCrit()
    }
]);

export const maybeAnonymousFullAuthorFilter = (): MinimalOrFullMaybeAnonymousFilter<AuthorCriteria> => ({
    include: [
        {
            criteria: authorAgeDayCrit()
        },
        {
            criteria: authorAgeMonthCrit()
        }
    ],
    exclude: [
        {
            criteria: authorAgeDayCrit()
        },
        {
            criteria: authorAgeMonthCrit()
        }
    ]
});
