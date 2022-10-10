import {OperatorConfig, OperatorJsonConfig} from "../src/Common/interfaces";
import Snoowrap from "snoowrap";
import Bot from "../src/Bot/index"
import {buildOperatorConfigWithDefaults} from "../src/ConfigBuilder";
import {App} from "../src/App";
import {YamlOperatorConfigDocument} from "../src/Common/Config/Operator";
import {NoopLogger} from "../src/Utils/loggerFactory";
import {ManagerEntity} from "../src/Common/Entities/ManagerEntity";
import {Bot as BotEntity} from "../src/Common/Entities/Bot";
import {SubredditResources} from "../src/Subreddit/SubredditResources";
import {Subreddit, Comment, Submission} from 'snoowrap/dist/objects';
import dayjs from 'dayjs';

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
