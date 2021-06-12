import Snoowrap from "snoowrap";
import {Manager} from "./Subreddit/Manager";
import winston, {Logger} from "winston";
import {argParseInt, labelledFormat, parseBool, sleep} from "./util";
import snoowrap from "snoowrap";
import pEvent from "p-event";
import JSON5 from 'json5';
import EventEmitter from "events";
import CacheManager from './Subreddit/SubredditCache';
import dayjs from "dayjs";

const {transports} = winston;

const snooLogWrapper = (logger: Logger) => {
    return {
        warn: (...args: any[]) => logger.warn(args.slice(0, 2).join(' '), [args.slice(2)]),
        debug: (...args: any[]) => logger.debug(args.slice(0, 2).join(' '), [args.slice(2)]),
        info: (...args: any[]) => logger.info(args.slice(0, 2).join(' '), [args.slice(2)]),
        trace: (...args: any[]) => logger.debug(args.slice(0, 2).join(' '), [args.slice(2)]),
    }
}

export class App {

    client: Snoowrap;
    subreddits: string[];
    subManagers: Manager[] = [];
    logger: Logger;
    wikiLocation: string;
    dryRun?: true | undefined;
    heartbeatInterval: number;
    apiLimitWarning: number;

    constructor(options: any = {}) {
        const {
            subreddits = [],
            clientId,
            clientSecret,
            accessToken,
            refreshToken,
            logDir = process.env.LOG_DIR || `${process.cwd()}/logs`,
            logLevel = process.env.LOG_LEVEL || 'info',
            wikiConfig = process.env.WIKI_CONFIG || 'botconfig/contextbot',
            snooDebug = process.env.SNOO_DEBUG || false,
            dryRun = process.env.DRYRUN || false,
            heartbeat = process.env.HEARTBEAT || 300,
            apiLimitWarning = process.env.API_REMAINING || 250,
            version,
            authorTTL = process.env.AUTHOR_TTL || 10000,
            disableCache = process.env.DISABLE_CACHE || false,
        } = options;

        CacheManager.authorTTL = argParseInt(authorTTL);
        CacheManager.enabled = !parseBool(disableCache);

        this.dryRun = parseBool(dryRun) === true ? true : undefined;
        this.heartbeatInterval = argParseInt(heartbeat);
        this.apiLimitWarning = argParseInt(apiLimitWarning);
        this.wikiLocation = wikiConfig;

        const consoleTransport = new transports.Console();

        const myTransports = [
            consoleTransport,
        ];

        if (logDir !== false) {
            let logPath = logDir;
            if (logPath === true) {
                logPath = `${process.cwd()}/logs`;
            }
            const rotateTransport = new winston.transports.DailyRotateFile({
                dirname: logPath,
                createSymlink: true,
                symlinkName: 'contextBot-current.log',
                filename: 'contextBot-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxSize: '5m'
            });
            // @ts-ignore
            myTransports.push(rotateTransport);
        }

        const loggerOptions = {
            level: logLevel || 'info',
            format: labelledFormat(),
            transports: myTransports,
            levels: {
                error: 0,
                warn: 1,
                info: 2,
                http: 3,
                verbose: 4,
                debug: 5,
                trace: 5,
                silly: 6
            }
        };

        winston.loggers.add('default', loggerOptions);

        this.logger = winston.loggers.get('default');

        if (this.dryRun) {
            this.logger.info('Running in DRYRUN mode');
        }

        let subredditsArg = [];
        if (subreddits !== undefined) {
            if (Array.isArray(subreddits)) {
                subredditsArg = subreddits;
            } else {
                subredditsArg = subreddits.split(',');
            }
        }
        this.subreddits = subredditsArg;

        const creds = {
            userAgent: `web:contextBot:${version}`,
            clientId,
            clientSecret,
            refreshToken,
            accessToken,
        };

        this.client = new snoowrap(creds);
        this.client.config({
            warnings: true,
            maxRetryAttempts: 5,
            debug: parseBool(snooDebug),
            logger: snooLogWrapper(this.logger.child({labels: ['Snoowrap']})),
            continueAfterRatelimitError: true,
        });
    }

    async buildManagers(subreddits: string[] = []) {
        let availSubs = [];
        const name = await this.client.getMe().name;
        this.logger.info(`Reddit API Limit Remaining: ${this.client.ratelimitRemaining}`);
        this.logger.info(`Authenticated Account: /u/${name}`);
        for (const sub of await this.client.getModeratedSubreddits()) {
            // TODO don't know a way to check permissions yet
            availSubs.push(sub);
        }
        this.logger.info(`/u/${name} is a moderator of these subreddits: ${availSubs.map(x => x.display_name_prefixed).join(', ')}`);

        let subsToRun = [];
        const subsToUse = subreddits.length > 0 ? subreddits : this.subreddits;
        if (subsToUse.length > 0) {
            this.logger.info(`User-defined subreddit constraints detected (CLI argument or environmental variable), will try to run on: ${subsToUse.join(', ')}`);
            for (const sub of subsToUse) {
                const asub = availSubs.find(x => x.display_name.toLowerCase() === sub.trim().toLowerCase())
                if (asub === undefined) {
                    this.logger.warn(`Will not run on ${sub} because is not modded by, or does not have appropriate permissions to mod with, for this client.`);
                } else {
                    // @ts-ignore
                    const fetchedSub = await asub.fetch();
                    subsToRun.push(fetchedSub);
                }
            }
        } else {
            // otherwise assume all moddable subs from client should be run on
            this.logger.info('No user-defined subreddit constraints detected, will try to run on all');
            subsToRun = availSubs;
        }

        let subSchedule: Manager[] = [];
        // get configs for subs we want to run on and build/validate them
        for (const sub of subsToRun) {
            let content = undefined;
            let json = undefined;
            try {
                const wiki = sub.getWikiPage(this.wikiLocation);
                content = await wiki.content_md;
            } catch (err) {
                this.logger.error(`[${sub.display_name_prefixed}] Could not read wiki configuration. Please ensure the page https://reddit.com${sub.url}wiki/${this.wikiLocation} exists and is readable -- error: ${err.message}`);
                continue;
            }
            try {
                json = JSON5.parse(content);

            } catch (err) {
                this.logger.error(`[${sub.display_name_prefixed}] Wiki page contents was not valid -- error: ${err.message}`);
                continue;
            }
            try {
                subSchedule.push(new Manager(sub, this.client, this.logger, json, {dryRun: this.dryRun}));
            } catch (err) {
                this.logger.error(`[${sub.display_name_prefixed}] Config was not valid`, undefined, err);
            }
        }
        this.subManagers = subSchedule;
    }

    async heartbeat() {
        while (true) {
            await sleep(this.heartbeatInterval * 1000);
            const heartbeat = `HEARTBEAT -- Reddit API Rate Limit remaining: ${this.client.ratelimitRemaining}`
            if (this.apiLimitWarning >= this.client.ratelimitRemaining) {
                this.logger.warn(heartbeat);
            } else {
                this.logger.info(heartbeat);
            }
        }
    }

    async runManagers() {

        for (const manager of this.subManagers) {
            manager.handle();
        }

        if (this.heartbeatInterval !== 0) {
            this.heartbeat();
        }

        const emitter = new EventEmitter();
        await pEvent(emitter, 'end');
    }
}
