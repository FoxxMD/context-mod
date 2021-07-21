import Snoowrap, {Subreddit} from "snoowrap";
import {Manager} from "./Subreddit/Manager";
import winston, {Logger} from "winston";
import {
    argParseInt,
    createRetryHandler, formatNumber,
    labelledFormat, logLevels,
    parseBool, parseDuration,
    parseFromJsonOrYamlToObject,
    parseSubredditName,
    sleep
} from "./util";
import pEvent from "p-event";
import EventEmitter from "events";
import CacheManager from './Subreddit/SubredditResources';
import dayjs, {Dayjs} from "dayjs";
import LoggedError from "./Utils/LoggedError";
import {ProxiedSnoowrap, RequestTrackingSnoowrap} from "./Utils/SnoowrapClients";
import {ModQueueStream, UnmoderatedStream} from "./Subreddit/Streams";
import {getDefaultLogger} from "./Utils/loggerFactory";
import {DurationString, PAUSED, RUNNING, STOPPED, SYSTEM, USER} from "./Common/interfaces";
import {sharedModqueue} from "./Utils/CommandConfig";
import { Duration } from "dayjs/plugin/duration";

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
    softLimit: number | string = 250;
    hardLimit: number | string = 50;
    nannyMode?: 'soft' | 'hard';
    nextExpiration!: Dayjs;
    botName?: string;
    startedAt: Dayjs = dayjs();
    sharedModqueue: boolean = false;

    apiSample: number[] = [];
    interval: any;
    apiRollingAvg: number = 0;
    apiEstDepletion?: Duration;
    depletedInSecs: number = 0;

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
            sharedModqueue = false,
        } = options;

        CacheManager.authorTTL = argParseInt(authorTTL);
        CacheManager.enabled = !parseBool(disableCache);

        this.dryRun = parseBool(dryRun) === true ? true : undefined;
        this.heartbeatInterval = argParseInt(heartbeat);
        this.apiLimitWarning = argParseInt(apiLimitWarning);
        this.wikiLocation = wikiConfig;
        this.sharedModqueue = sharedModqueue;

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

        const retryHandler = createRetryHandler({maxRequestRetry: 8, maxOtherRetry: 1}, this.logger);

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
            this.logger.info(`Operator-defined subreddit constraints detected (CLI argument or environmental variable), will try to run on: ${subsToUse.join(', ')}`);
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
            const manager = new Manager(sub, this.client, this.logger, {dryRun: this.dryRun, sharedModqueue: this.sharedModqueue});
            try {
                await manager.parseConfiguration('system', true);
            } catch (err) {
                if (!(err instanceof LoggedError)) {
                    this.logger.error(`Config was not valid:`, {subreddit: sub.display_name_prefixed});
                    this.logger.error(err, {subreddit: sub.display_name_prefixed});
                }
            }
            subSchedule.push(manager);
        }
        this.subManagers = subSchedule;
    }

    async heartbeat() {
        try {
            this.heartBeating = true;
            while (true) {
                this.nextHeartbeat = dayjs().add(this.heartbeatInterval, 'second');
                await sleep(this.heartbeatInterval * 1000);
                const heartbeat = `HEARTBEAT -- API Remaining: ${this.client.ratelimitRemaining} | Usage Rolling Avg: ${this.apiRollingAvg}/s | Est Depletion: ${this.apiEstDepletion === undefined ? 'N/A' : this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`
                if (this.apiLimitWarning >= this.client.ratelimitRemaining) {
                    this.logger.warn(heartbeat);
                } else {
                    this.logger.info(heartbeat);
                }
                for (const s of this.subManagers) {
                    if(s.botState.state === STOPPED && s.botState.causedBy === USER) {
                        this.logger.debug('Skipping config check/restart on heartbeat due to previously being stopped by user', {subreddit: s.displayLabel});
                        continue;
                    }
                    try {
                        const newConfig = await s.parseConfiguration();
                        if(newConfig || (s.queueState.state !== RUNNING && s.queueState.causedBy === SYSTEM))
                        {
                            await s.startQueue();
                        }
                        if(newConfig || (s.eventsState.state !== RUNNING && s.eventsState.causedBy === SYSTEM))
                        {
                            await s.startEvents();
                        }
                        if(s.botState.state !== RUNNING && s.eventsState.state === RUNNING && s.queueState.state === RUNNING) {
                            s.botState = {
                                state: RUNNING,
                                causedBy: 'system',
                            }
                        }
                    } catch (err) {
                        this.logger.info('Stopping event polling to prevent activity processing queue from backing up. Will be restarted when config update succeeds.')
                        await s.stopEvents();
                        if(!(err instanceof LoggedError)) {
                            this.logger.error(err, {subreddit: s.displayLabel});
                        }
                        if(this.nextHeartbeat !== undefined) {
                            this.logger.info(`Will retry parsing config on next heartbeat (in ${dayjs.duration(this.nextHeartbeat.diff(dayjs())).humanize()})`, {subreddit: s.displayLabel});
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
        // this.apiSampleInterval = setInterval((function(self) {
        //     return function() {
        //         const rollingSample = self.apiSample.slice(0, 7)
        //         rollingSample.unshift(self.client.ratelimitRemaining);
        //         self.apiSample = rollingSample;
        //         const diff = self.apiSample.reduceRight((acc: number[], curr, index) => {
        //             if(self.apiSample[index + 1] !== undefined) {
        //                 const d = Math.abs(curr - self.apiSample[index + 1]);
        //                 if(d === 0) {
        //                     return [...acc, 0];
        //                 }
        //                 return [...acc, d/10];
        //             }
        //             return acc;
        //         }, []);
        //         self.apiRollingAvg = diff.reduce((acc, curr) => acc + curr,0) / diff.length; // api requests per second
        //         const depletedIn = self.client.ratelimitRemaining / self.apiRollingAvg; // number of seconds until current remaining limit is 0
        //         self.apiEstDepletion = dayjs.duration({seconds: depletedIn});
        //         self.logger.info(`API Usage Rolling Avg: ${self.apiRollingAvg}/s | Est Depletion: ${self.apiEstDepletion.humanize()} (${depletedIn} seconds)`);
        //     }
        // })(this), 10000);

        if(this.subManagers.every(x => !x.validConfigLoaded)) {
            this.logger.warn('All managers have invalid configs!');
        }
        for (const manager of this.subManagers) {
            if (manager.validConfigLoaded && manager.botState.state !== RUNNING) {
                await manager.start();
            }
        }

        await this.runModStreams();

        if (this.heartbeatInterval !== 0 && !this.heartBeating) {
            this.heartbeat();
        }
        this.runApiNanny();

        const emitter = new EventEmitter();
        await pEvent(emitter, 'end');
    }
    
    async runApiNanny() {
        while(true) {
            await sleep(10000);
            this.nextExpiration = dayjs(this.client.ratelimitExpiration);
            const nowish = dayjs().add(10, 'second');
            if(nowish.isAfter(this.nextExpiration)) {
                // it's possible no api calls are being made because of a hard limit
                // need to make an api call to update this
                // @ts-ignore
                await this.client.getMe();
                this.nextExpiration = dayjs(this.client.ratelimitExpiration);
            }
            const rollingSample = this.apiSample.slice(0, 7)
            rollingSample.unshift(this.client.ratelimitRemaining);
            this.apiSample = rollingSample;
            const diff = this.apiSample.reduceRight((acc: number[], curr, index) => {
                if(this.apiSample[index + 1] !== undefined) {
                    const d = Math.abs(curr - this.apiSample[index + 1]);
                    if(d === 0) {
                        return [...acc, 0];
                    }
                    return [...acc, d/10];
                }
                return acc;
            }, []);
            this.apiRollingAvg = diff.reduce((acc, curr) => acc + curr,0) / diff.length; // api requests per second
            this.depletedInSecs = this.client.ratelimitRemaining / this.apiRollingAvg; // number of seconds until current remaining limit is 0
            this.apiEstDepletion = dayjs.duration({seconds: this.depletedInSecs});
            this.logger.info(`API Usage Rolling Avg: ${formatNumber(this.apiRollingAvg)}/s | Est Depletion: ${this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`);


            let hardLimitHit = false;
            if(typeof this.hardLimit === 'string') {
                const hardDur = parseDuration(this.hardLimit);
                hardLimitHit = hardDur.asSeconds() > this.apiEstDepletion.asSeconds();
            } else {
                hardLimitHit = this.hardLimit > this.client.ratelimitRemaining;
            }

            if(hardLimitHit) {
                if(this.nannyMode === 'hard') {
                    continue;
                }
                this.logger.info(`Detected HARD LIMIT of ${this.hardLimit} remaining`, {leaf: 'Api Nanny'});
                this.logger.info(`API Remaining: ${this.client.ratelimitRemaining} | Usage Rolling Avg: ${this.apiRollingAvg}/s | Est Depletion: ${this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`, {leaf: 'Api Nanny'});
                this.logger.info(`All subreddit event polling has been paused`, {leaf: 'Api Nanny'});

                for(const m of this.subManagers) {
                    m.pauseEvents('system');
                }

                this.nannyMode = 'hard';
                continue;
            }

            let softLimitHit = false;
            if(typeof this.softLimit === 'string') {
                const softDur = parseDuration(this.softLimit);
                softLimitHit = softDur.asSeconds() > this.apiEstDepletion.asSeconds();
            } else {
                softLimitHit = this.softLimit > this.client.ratelimitRemaining;
            }

            if(softLimitHit) {
                if(this.nannyMode === 'soft') {
                    continue;
                }
                this.logger.info(`Detected SOFT LIMIT of ${this.softLimit} remaining`, {leaf: 'Api Nanny'});
                this.logger.info(`API Remaining: ${this.client.ratelimitRemaining} | Usage Rolling Avg: ${formatNumber(this.apiRollingAvg)}/s | Est Depletion: ${this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`, {leaf: 'Api Nanny'});
                this.logger.info('Trying to detect heavy usage subreddits...', {leaf: 'Api Nanny'});
                let threshold = 0.5;
                let offenders = this.subManagers.filter(x => {
                    const combinedPerSec = x.eventsRollingAvg + x.rulesUniqueRollingAvg;
                    return combinedPerSec > threshold;
                });
                if(offenders.length === 0) {
                    threshold = 0.25;
                    // reduce threshold
                    offenders = this.subManagers.filter(x => {
                        const combinedPerSec = x.eventsRollingAvg + x.rulesUniqueRollingAvg;
                        return combinedPerSec > threshold;
                    });
                }

                if(offenders.length > 0) {
                    this.logger.info(`Slowing subreddits using >- ${threshold}req/s:`, {leaf: 'Api Nanny'});
                    for(const m of offenders) {
                        m.delayBy = 1.5;
                        m.logger.info(`SLOW MODE (Currently ~${formatNumber(m.eventsRollingAvg + m.rulesUniqueRollingAvg)}req/sec)`, {leaf: 'Api Nanny'});
                    }
                } else {
                    this.logger.info(`Couldn't detect specific offenders, slowing all...`, {leaf: 'Api Nanny'});
                    for(const m of this.subManagers) {
                        m.delayBy = 1.5;
                        m.logger.info(`SLOW MODE (Currently ~${formatNumber(m.eventsRollingAvg + m.rulesUniqueRollingAvg)}req/sec)`, {leaf: 'Api Nanny'});
                    }
                }
                this.nannyMode = 'soft';
                continue;
            }

            if(this.nannyMode !== undefined) {
                this.logger.info('Turning off due to better conditions...', {leaf: 'Api Nanny'});
                for(const m of this.subManagers) {
                    m.delayBy = undefined;
                    if(m.queueState.state === PAUSED && m.queueState.causedBy === SYSTEM) {
                        m.startQueue();
                    }
                    if(m.eventsState.state === PAUSED && m.eventsState.causedBy === SYSTEM) {
                        await m.startEvents();
                    }
                }
                this.nannyMode = undefined;
            }
        }
    }
}
