import Snoowrap, {Subreddit} from "snoowrap";
import {Manager} from "./Subreddit/Manager";
import winston, {Logger} from "winston";
import {
    argParseInt,
    createRetryHandler,
    labelledFormat, logLevels,
    parseBool,
    parseFromJsonOrYamlToObject,
    parseSubredditName,
    sleep
} from "./util";
import pEvent from "p-event";
import EventEmitter from "events";
import CacheManager from './Subreddit/SubredditResources';
import dayjs, {Dayjs} from "dayjs";
import LoggedError from "./Utils/LoggedError";
import ProxiedSnoowrap from "./Utils/ProxiedSnoowrap";
import {ModQueueStream, UnmoderatedStream} from "./Subreddit/Streams";
import {getDefaultLogger} from "./Utils/loggerFactory";

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
    nextHeartbeat?: Dayjs;
    heartBeating: boolean = false;
    apiLimitWarning: number;
    botName?: string;
    startedAt: Dayjs = dayjs();

    constructor(options: any = {}) {
        const {
            subreddits = [],
            clientId = process.env.CLIENT_ID,
            clientSecret = process.env.CLIENT_SECRET,
            accessToken = process.env.ACCESS_TOKEN,
            refreshToken = process.env.REFRESH_TOKEN,
            wikiConfig = process.env.WIKI_CONFIG || 'botconfig/contextbot',
            snooDebug = process.env.SNOO_DEBUG || false,
            dryRun = process.env.DRYRUN || false,
            heartbeat = process.env.HEARTBEAT || 300,
            apiLimitWarning = process.env.API_REMAINING || 250,
            version,
            authorTTL = process.env.AUTHOR_TTL || 10000,
            disableCache = process.env.DISABLE_CACHE || false,
            proxy = process.env.PROXY,
        } = options;

        CacheManager.authorTTL = argParseInt(authorTTL);
        CacheManager.enabled = !parseBool(disableCache);

        this.dryRun = parseBool(dryRun) === true ? true : undefined;
        this.heartbeatInterval = argParseInt(heartbeat);
        this.apiLimitWarning = argParseInt(apiLimitWarning);
        this.wikiLocation = wikiConfig;

        this.logger = getDefaultLogger(options);

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
        this.subreddits = subredditsArg.map(parseSubredditName);

        const creds = {
            userAgent: `web:contextBot:${version}`,
            clientId,
            clientSecret,
            refreshToken,
            accessToken,
        };

        const missingCreds = [];
        for(const [k,v] of Object.entries(creds)) {
            if(v === undefined || v === '' || v === null) {
                missingCreds.push(k);
            }
        }
        if(missingCreds.length > 0) {
            this.logger.error('There are credentials missing that would prevent initializing the Reddit API Client and subsequently the rest of the application');
            this.logger.error(`Missing credentials: ${missingCreds.join(', ')}`)
            this.logger.info(`If this is a first-time setup use the 'web' command for a web-based guide to configuring your application`);
            this.logger.info(`Or check the USAGE section of the readme for the correct naming of these arguments/environment variables`);
            throw new LoggedError(`Missing credentials: ${missingCreds.join(', ')}`);
        }

        this.client = proxy === undefined ? new Snoowrap(creds) : new ProxiedSnoowrap({...creds, proxy});
        this.client.config({
            warnings: true,
            maxRetryAttempts: 5,
            debug: parseBool(snooDebug),
            logger: snooLogWrapper(this.logger.child({labels: ['Snoowrap']})),
            continueAfterRatelimitError: true,
        });

        const retryHandler = createRetryHandler({maxRequestRetry: 5, maxOtherRetry: 1}, this.logger);

        const modStreamErrorListener = (name: string) => async (err: any) => {
            this.logger.error('Polling error occurred', err);
            const shouldRetry = await retryHandler(err);
            if(shouldRetry) {
                defaultUnmoderatedStream.startInterval();
            } else {
                this.logger.error(`Mod stream ${name.toUpperCase()} encountered too many errors while polling. Will try to restart on next heartbeat.`);
            }
        }

        const defaultUnmoderatedStream = new UnmoderatedStream(this.client, {subreddit: 'mod'});
        // @ts-ignore
        defaultUnmoderatedStream.on('error', modStreamErrorListener('unmoderated'));
        const defaultModqueueStream = new ModQueueStream(this.client, {subreddit: 'mod'});
        // @ts-ignore
        defaultModqueueStream.on('error', modStreamErrorListener('modqueue'));
        CacheManager.modStreams.set('unmoderated', defaultUnmoderatedStream);
        CacheManager.modStreams.set('modqueue', defaultModqueueStream);
    }

    async testClient() {
        try {
            // @ts-ignore
            await this.client.getMe();
            this.logger.info('Test API call successful');
        } catch (err) {
            this.logger.error('An error occurred while trying to initialize the Reddit API Client which would prevent the entire application from running.');
            if(err.name === 'StatusCodeError') {
                const authHeader = err.response.headers['www-authenticate'];
                if (authHeader !== undefined && authHeader.includes('insufficient_scope')) {
                    this.logger.error('Reddit responded with a 403 insufficient_scope. Please ensure you have chosen the correct scopes when authorizing your account.');
                } else if(err.statusCode === 401) {
                    this.logger.error('It is likely a credential is missing or incorrect. Check clientId, clientSecret, refreshToken, and accessToken');
                }
                this.logger.error(`Error Message: ${err.message}`);
            } else {
                this.logger.error(err);
            }
            err.logged = true;
            throw err;
        }
    }

    async buildManagers(subreddits: string[] = []) {
        let availSubs = [];
        const name = await this.client.getMe().name;
        this.logger.info(`Reddit API Limit Remaining: ${this.client.ratelimitRemaining}`);
        this.logger.info(`Authenticated Account: /u/${name}`);
        this.botName = name;
        for (const sub of await this.client.getModeratedSubreddits()) {
            // TODO don't know a way to check permissions yet
            availSubs.push(sub);
        }
        this.logger.info(`/u/${name} is a moderator of these subreddits: ${availSubs.map(x => x.display_name_prefixed).join(', ')}`);

        let subsToRun: Subreddit[] = [];
        const subsToUse = subreddits.length > 0 ? subreddits.map(parseSubredditName) : this.subreddits;
        if (subsToUse.length > 0) {
            this.logger.info(`User-defined subreddit constraints detected (CLI argument or environmental variable), will try to run on: ${subsToUse.join(', ')}`);
            for (const sub of subsToUse) {
                const asub = availSubs.find(x => x.display_name.toLowerCase() === sub.toLowerCase())
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
            let wiki;
            try {
                // @ts-ignore
                wiki = await sub.getWikiPage(this.wikiLocation).fetch();
                content = wiki.content_md;
            } catch (err) {
                this.logger.error(`{${sub.display_name_prefixed}} Could not read wiki configuration. Please ensure the page https://reddit.com${sub.url}wiki/${this.wikiLocation} exists and is readable -- error: ${err.message}`);
                continue;
            }

            if (content === '') {
                this.logger.error(`{${sub.display_name_prefixed}} Wiki page contents was empty`);
                continue;
            }

            const [configObj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(content);

            if (configObj === undefined) {
                this.logger.error(`{${sub.display_name_prefixed}} Could not parse wiki page contents as JSON or YAML:`);
                this.logger.error(jsonErr);
                this.logger.error(yamlErr);
                continue;
            }

            try {
                const manager = new Manager(sub, this.client, this.logger, configObj, {dryRun: this.dryRun});
                manager.lastWikiCheck = dayjs();
                manager.lastWikiRevision = dayjs.unix(wiki.revision_date);
                subSchedule.push(manager);
            } catch (err) {
                if (!(err instanceof LoggedError)) {
                    this.logger.error(`{${sub.display_name_prefixed}} Config was not valid`, err);
                }
            }
        }
        this.subManagers = subSchedule;
    }

    async heartbeat() {
        try {
            this.heartBeating = true;
            while (true) {
                this.nextHeartbeat = dayjs().add(this.heartbeatInterval, 'second');
                await sleep(this.heartbeatInterval * 1000);
                const heartbeat = `HEARTBEAT -- Reddit API Rate Limit remaining: ${this.client.ratelimitRemaining}`
                if (this.apiLimitWarning >= this.client.ratelimitRemaining) {
                    this.logger.warn(heartbeat);
                } else {
                    this.logger.info(heartbeat);
                }
                for (const s of this.subManagers) {
                    try {
                        const newConfig = await s.parseConfiguration();
                        if (newConfig || !s.running) {
                            await s.buildPolling();
                            s.handle();
                        }
                    } catch (err) {
                        s.stop();
                        if(!(err instanceof LoggedError)) {
                            this.logger.info('Will retry parsing config on next heartbeat...');
                        }
                    }
                }
                await this.runModStreams();
            }
        } catch (err) {
            this.logger.error('Error occurred during heartbeat', err);
            throw err;
        } finally {
            this.nextHeartbeat = undefined;
            this.heartBeating = false;
        }
    }

    async runModStreams() {
        for(const [k,v] of CacheManager.modStreams) {
            if(!v.running && v.listeners('item').length > 0) {
                v.startInterval();
                this.logger.info(`Starting default ${k.toUpperCase()} mod stream`);
            }
        }
    }

    async runManagers() {
        for (const manager of this.subManagers) {
            if (!manager.running) {
                await manager.buildPolling();
                manager.handle();
            }
        }

        if (this.heartbeatInterval !== 0 && !this.heartBeating) {
            this.heartbeat();
        }

        await this.runModStreams();

        const emitter = new EventEmitter();
        await pEvent(emitter, 'end');
    }
}
