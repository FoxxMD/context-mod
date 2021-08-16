import Snoowrap, {Subreddit} from "snoowrap";
import {Logger} from "winston";
import dayjs, {Dayjs} from "dayjs";
import {Duration} from "dayjs/plugin/duration";
import EventEmitter from "events";
import {BotInstanceConfig, Invokee, PAUSED, RUNNING, SYSTEM} from "../Common/interfaces";
import {
    createRetryHandler,
    formatNumber,
    mergeArr,
    parseBool,
    parseDuration,
    parseSubredditName,
    sleep,
    snooLogWrapper
} from "../util";
import {Manager} from "../Subreddit/Manager";
import {ProxiedSnoowrap} from "../Utils/SnoowrapClients";
import {ModQueueStream, UnmoderatedStream} from "../Subreddit/Streams";
import {BotResourcesManager} from "../Subreddit/SubredditResources";
import LoggedError from "../Utils/LoggedError";
import pEvent from "p-event";


class Bot {

    client!: Snoowrap;
    logger!: Logger;
    wikiLocation: string;
    dryRun?: true | undefined;
    running: boolean = false;
    subreddits: string[];
    subManagers: Manager[] = [];
    heartbeatInterval: number;
    nextHeartbeat?: Dayjs;
    heartBeating: boolean = false;

    softLimit: number | string = 250;
    hardLimit: number | string = 50;
    nannyMode?: 'soft' | 'hard';
    nextExpiration: Dayjs = dayjs();
    botName?: string;
    botLink?: string;
    maxWorkers: number;
    startedAt: Dayjs = dayjs();
    sharedModqueue: boolean = false;

    apiSample: number[] = [];
    apiRollingAvg: number = 0;
    apiEstDepletion?: Duration;
    depletedInSecs: number = 0;

    error: any;
    emitter: EventEmitter = new EventEmitter();

    cacheManager: BotResourcesManager;

    getBotName = () => {
        return this.botName;
    }

    getUserAgent = () => {
        return `web:contextMod:${this.botName}`
    }

    constructor(config: BotInstanceConfig, logger: Logger) {
        const {
            notifications,
            name,
            subreddits: {
                names = [],
                wikiConfig,
                dryRun,
                heartbeatInterval,
            },
            credentials: {
                clientId,
                clientSecret,
                refreshToken,
                accessToken,
            },
            snoowrap: {
                proxy,
                debug,
            },
            polling: {
                sharedMod,
            },
            queue: {
                maxWorkers,
            },
            caching: {
                authorTTL,
                provider: {
                    store
                }
            },
            nanny: {
                softLimit,
                hardLimit,
            }
        } = config;

        this.cacheManager = new BotResourcesManager(config);

        this.dryRun = parseBool(dryRun) === true ? true : undefined;
        this.softLimit = softLimit;
        this.hardLimit = hardLimit;
        this.wikiLocation = wikiConfig;
        this.heartbeatInterval = heartbeatInterval;
        this.sharedModqueue = sharedMod;
        if(name !== undefined) {
            this.botName = name;
        }

        const getBotName = this.getBotName;
        const getUserName = this.getUserAgent;

        this.logger = logger.child({
            get bot() {
                return getBotName();
            }
        }, mergeArr);

        let mw = maxWorkers;
        if(maxWorkers < 1) {
            this.logger.warn(`Max queue workers must be greater than or equal to 1 (Specified: ${maxWorkers})`);
            mw = 1;
        }
        this.maxWorkers = mw;

        if (this.dryRun) {
            this.logger.info('Running in DRYRUN mode');
        }

        this.subreddits = names.map(parseSubredditName);

        let creds: any = {
            get userAgent() { return getUserName() },
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
            this.error = `Missing credentials: ${missingCreds.join(', ')}`;
            //throw new LoggedError(`Missing credentials: ${missingCreds.join(', ')}`);
        }

        try {
            this.client = proxy === undefined ? new Snoowrap(creds) : new ProxiedSnoowrap({...creds, proxy});
            this.client.config({
                warnings: true,
                maxRetryAttempts: 5,
                debug,
                logger: snooLogWrapper(this.logger.child({labels: ['Snoowrap']})),
                continueAfterRatelimitError: true,
            });
        } catch (err) {
            if(this.error === undefined) {
                this.error = err.message;
                this.logger.error(err);
            }
        }

        const retryHandler = createRetryHandler({maxRequestRetry: 8, maxOtherRetry: 1}, this.logger);

        const modStreamErrorListener = (name: string) => async (err: any) => {
            this.logger.error('Polling error occurred', err);
            const shouldRetry = await retryHandler(err);
            if(shouldRetry) {
                defaultUnmoderatedStream.startInterval();
            } else {
                for(const m of this.subManagers) {
                    if(m.modStreamCallbacks.size > 0) {
                        m.notificationManager.handle('runStateChanged', `${name.toUpperCase()} Polling Stopped`, 'Encountered too many errors from Reddit while polling. Will try to restart on next heartbeat.');
                    }
                }
                this.logger.error(`Mod stream ${name.toUpperCase()} encountered too many errors while polling. Will try to restart on next heartbeat.`);
            }
        }

        const defaultUnmoderatedStream = new UnmoderatedStream(this.client, {subreddit: 'mod'});
        // @ts-ignore
        defaultUnmoderatedStream.on('error', modStreamErrorListener('unmoderated'));
        const defaultModqueueStream = new ModQueueStream(this.client, {subreddit: 'mod'});
        // @ts-ignore
        defaultModqueueStream.on('error', modStreamErrorListener('modqueue'));
        this.cacheManager.modStreams.set('unmoderated', defaultUnmoderatedStream);
        this.cacheManager.modStreams.set('modqueue', defaultModqueueStream);

        process.on('uncaughtException', (e) => {
            this.error = e;
        });
        process.on('unhandledRejection', (e) => {
            this.error = e;
        });
        process.on('exit', async (code) => {
            if(code === 0) {
                await this.onTerminate();
            } else if(this.error !== undefined) {
                let errMsg;
                if(typeof this.error === 'object' && this.error.message !== undefined) {
                    errMsg = this.error.message;
                } else if(typeof this.error === 'string') {
                    errMsg = this.error;
                }
                await this.onTerminate(`Application exited due to an unexpected error${errMsg !== undefined ? `: ${errMsg}` : ''}`);
            } else {
                await this.onTerminate(`Application exited with unclean exit signal (${code})`);
            }
        });
    }

    async onTerminate(reason = 'The application was shutdown') {
        for(const m of this.subManagers) {
            await m.notificationManager.handle('runStateChanged', 'Application Shutdown', reason);
        }
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
            this.error = `Error occurred while testing Reddit API client: ${err.message}`;
            err.logged = true;
            throw err;
        }
    }

    async buildManagers(subreddits: string[] = []) {
        let availSubs = [];
        // @ts-ignore
        const user = await this.client.getMe().fetch();
        this.botLink = `https://reddit.com/user/${user.name}`;
        this.logger.info(`Reddit API Limit Remaining: ${this.client.ratelimitRemaining}`);
        this.logger.info(`Authenticated Account: u/${user.name}`);

        const botNameFromConfig = this.botName !== undefined;
        if(this.botName === undefined) {
            this.botName = `u/${user.name}`;
        }
        this.logger.info(`Bot Name${botNameFromConfig ? ' (from config)' : ''}: ${this.botName}`);

        for (const sub of await this.client.getModeratedSubreddits()) {
            // TODO don't know a way to check permissions yet
            availSubs.push(sub);
        }
        this.logger.info(`u/${user.name} is a moderator of these subreddits: ${availSubs.map(x => x.display_name_prefixed).join(', ')}`);

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
            const manager = new Manager(sub, this.client, this.logger, this.cacheManager, {dryRun: this.dryRun, sharedModqueue: this.sharedModqueue, wikiLocation: this.wikiLocation, botName: this.botName, maxWorkers: this.maxWorkers});
            try {
                await manager.parseConfiguration('system', true, {suppressNotification: true});
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

    async destroy(causedBy: Invokee) {
        this.logger.info('Stopping heartbeat and nanny processes, may take up to 5 seconds...');
        const processWait = Promise.all([pEvent(this.emitter, 'heartbeatStopped'), pEvent(this.emitter, 'nannyStopped')]);
        this.running = false;
        await processWait;
        for (const manager of this.subManagers) {
            await manager.stop(causedBy, {reason: 'App rebuild'});
        }
        this.logger.info('Bot is stopped.');
    }

    async runModStreams(notify = false) {
        for(const [k,v] of this.cacheManager.modStreams) {
            if(!v.running && v.listeners('item').length > 0) {
                v.startInterval();
                this.logger.info(`Starting default ${k.toUpperCase()} mod stream`);
                if(notify) {
                    for(const m of this.subManagers) {
                        if(m.modStreamCallbacks.size > 0) {
                            await m.notificationManager.handle('runStateChanged', `${k.toUpperCase()} Polling Started`, 'Polling was successfully restarted on heartbeat.');
                        }
                    }
                }
            }
        }
    }

    async runManagers(causedBy: Invokee = 'system') {
        if(this.subManagers.every(x => !x.validConfigLoaded)) {
            this.logger.warn('All managers have invalid configs!');
            this.error = 'All managers have invalid configs';
        }
        for (const manager of this.subManagers) {
            if (manager.validConfigLoaded && manager.botState.state !== RUNNING) {
                await manager.start(causedBy, {reason: 'Caused by application startup'});
            }
        }

        await this.runModStreams();

        this.running = true;
        this.runApiNanny();
    }

    async runApiNanny() {
        try {
            mainLoop:
                while (this.running) {
                    for(let i = 0; i < 2; i++) {
                        await sleep(5000);
                        if (!this.running) {
                            break mainLoop;
                        }
                    }

                    this.nextExpiration = dayjs(this.client.ratelimitExpiration);
                    const nowish = dayjs().add(10, 'second');
                    if (nowish.isAfter(this.nextExpiration)) {
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
                        if (this.apiSample[index + 1] !== undefined) {
                            const d = Math.abs(curr - this.apiSample[index + 1]);
                            if (d === 0) {
                                return [...acc, 0];
                            }
                            return [...acc, d / 10];
                        }
                        return acc;
                    }, []);
                    this.apiRollingAvg = diff.reduce((acc, curr) => acc + curr, 0) / diff.length; // api requests per second
                    this.depletedInSecs = this.client.ratelimitRemaining / this.apiRollingAvg; // number of seconds until current remaining limit is 0
                    this.apiEstDepletion = dayjs.duration({seconds: this.depletedInSecs});
                    this.logger.debug(`API Usage Rolling Avg: ${formatNumber(this.apiRollingAvg)}/s | Est Depletion: ${this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`);


                    let hardLimitHit = false;
                    if (typeof this.hardLimit === 'string') {
                        const hardDur = parseDuration(this.hardLimit);
                        hardLimitHit = hardDur.asSeconds() > this.apiEstDepletion.asSeconds();
                    } else {
                        hardLimitHit = this.hardLimit > this.client.ratelimitRemaining;
                    }

                    if (hardLimitHit) {
                        if (this.nannyMode === 'hard') {
                            continue;
                        }
                        this.logger.info(`Detected HARD LIMIT of ${this.hardLimit} remaining`, {leaf: 'Api Nanny'});
                        this.logger.info(`API Remaining: ${this.client.ratelimitRemaining} | Usage Rolling Avg: ${this.apiRollingAvg}/s | Est Depletion: ${this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`, {leaf: 'Api Nanny'});
                        this.logger.info(`All subreddit event polling has been paused`, {leaf: 'Api Nanny'});

                        for (const m of this.subManagers) {
                            m.pauseEvents('system');
                            m.notificationManager.handle('runStateChanged', 'Hard Limit Triggered', `Hard Limit of ${this.hardLimit} hit (API Remaining: ${this.client.ratelimitRemaining}). Subreddit event polling has been paused.`, 'system', 'warn');
                        }

                        this.nannyMode = 'hard';
                        continue;
                    }

                    let softLimitHit = false;
                    if (typeof this.softLimit === 'string') {
                        const softDur = parseDuration(this.softLimit);
                        softLimitHit = softDur.asSeconds() > this.apiEstDepletion.asSeconds();
                    } else {
                        softLimitHit = this.softLimit > this.client.ratelimitRemaining;
                    }

                    if (softLimitHit) {
                        if (this.nannyMode === 'soft') {
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
                        if (offenders.length === 0) {
                            threshold = 0.25;
                            // reduce threshold
                            offenders = this.subManagers.filter(x => {
                                const combinedPerSec = x.eventsRollingAvg + x.rulesUniqueRollingAvg;
                                return combinedPerSec > threshold;
                            });
                        }

                        if (offenders.length > 0) {
                            this.logger.info(`Slowing subreddits using >- ${threshold}req/s:`, {leaf: 'Api Nanny'});
                            for (const m of offenders) {
                                m.delayBy = 1.5;
                                m.logger.info(`SLOW MODE (Currently ~${formatNumber(m.eventsRollingAvg + m.rulesUniqueRollingAvg)}req/sec)`, {leaf: 'Api Nanny'});
                                m.notificationManager.handle('runStateChanged', 'Soft Limit Triggered', `Soft Limit of ${this.softLimit} hit (API Remaining: ${this.client.ratelimitRemaining}). Subreddit queue processing will be slowed to 1.5 seconds per.`, 'system', 'warn');
                            }
                        } else {
                            this.logger.info(`Couldn't detect specific offenders, slowing all...`, {leaf: 'Api Nanny'});
                            for (const m of this.subManagers) {
                                m.delayBy = 1.5;
                                m.logger.info(`SLOW MODE (Currently ~${formatNumber(m.eventsRollingAvg + m.rulesUniqueRollingAvg)}req/sec)`, {leaf: 'Api Nanny'});
                                m.notificationManager.handle('runStateChanged', 'Soft Limit Triggered', `Soft Limit of ${this.softLimit} hit (API Remaining: ${this.client.ratelimitRemaining}). Subreddit queue processing will be slowed to 1.5 seconds per.`, 'system', 'warn');
                            }
                        }
                        this.nannyMode = 'soft';
                        continue;
                    }

                    if (this.nannyMode !== undefined) {
                        this.logger.info('Turning off due to better conditions...', {leaf: 'Api Nanny'});
                        for (const m of this.subManagers) {
                            if (m.delayBy !== undefined) {
                                m.delayBy = undefined;
                                m.notificationManager.handle('runStateChanged', 'Normal Processing Resumed', 'Slow Mode has been turned off due to better API conditions', 'system');
                            }
                            if (m.queueState.state === PAUSED && m.queueState.causedBy === SYSTEM) {
                                m.startQueue('system', {reason: 'API Nanny has been turned off due to better API conditions'});
                            }
                            if (m.eventsState.state === PAUSED && m.eventsState.causedBy === SYSTEM) {
                                await m.startEvents('system', {reason: 'API Nanny has been turned off due to better API conditions'});
                            }
                        }
                        this.nannyMode = undefined;
                    }
                }
        } catch (err) {
            this.logger.error('Error occurred during nanny loop', err);
            throw err;
        } finally {
            this.logger.info('Nanny stopped');
            this.emitter.emit('nannyStopped');
        }
    }
}

export default Bot;
