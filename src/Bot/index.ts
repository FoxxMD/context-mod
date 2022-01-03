import Snoowrap, {Comment, Submission, Subreddit} from "snoowrap";
import {Logger} from "winston";
import dayjs, {Dayjs} from "dayjs";
import {Duration} from "dayjs/plugin/duration";
import EventEmitter from "events";
import {BotInstanceConfig, Invokee, PAUSED, RUNNING, STOPPED, SYSTEM, USER} from "../Common/interfaces";
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
import {ExtendedSnoowrap, ProxiedSnoowrap} from "../Utils/SnoowrapClients";
import {ModQueueStream, UnmoderatedStream} from "../Subreddit/Streams";
import {BotResourcesManager} from "../Subreddit/SubredditResources";
import LoggedError from "../Utils/LoggedError";
import pEvent from "p-event";
import SimpleError from "../Utils/SimpleError";
import {isRateLimitError, isStatusError} from "../Utils/Errors";


class Bot {

    client!: ExtendedSnoowrap;
    logger!: Logger;
    wikiLocation: string;
    dryRun?: true | undefined;
    running: boolean = false;
    subreddits: string[];
    excludeSubreddits: string[];
    subManagers: Manager[] = [];
    heartbeatInterval: number;
    nextHeartbeat: Dayjs = dayjs();
    heartBeating: boolean = false;

    softLimit: number | string = 250;
    hardLimit: number | string = 50;
    nannyMode?: 'soft' | 'hard';
    nannyRunning: boolean = false;
    nextNannyCheck: Dayjs = dayjs().add(10, 'second');
    nannyRetryHandler: Function;
    managerRetryHandler: Function;
    nextExpiration: Dayjs = dayjs();
    botName?: string;
    botLink?: string;
    botAccount?: string;
    maxWorkers: number;
    startedAt: Dayjs = dayjs();
    sharedModqueue: boolean = false;
    streamListedOnce: string[] = [];

    stagger: number;

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
                exclude = [],
                wikiConfig,
                dryRun,
                heartbeatInterval,
            },
            credentials: {
                reddit: {
                    clientId,
                    clientSecret,
                    refreshToken,
                    accessToken,
                },
            },
            snoowrap: {
                proxy,
                debug,
            },
            polling: {
                sharedMod,
                stagger = 2000,
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
        this.excludeSubreddits = exclude.map(parseSubredditName);

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
            this.client = proxy === undefined ? new ExtendedSnoowrap(creds) : new ProxiedSnoowrap({...creds, proxy});
            this.client.config({
                warnings: true,
                maxRetryAttempts: 5,
                debug,
                logger: snooLogWrapper(this.logger.child({labels: ['Snoowrap']}, mergeArr)),
                continueAfterRatelimitError: false,
            });
        } catch (err: any) {
            if(this.error === undefined) {
                this.error = err.message;
                this.logger.error(err);
            }
        }

        const retryHandler = createRetryHandler({maxRequestRetry: 8, maxOtherRetry: 1}, this.logger);
        this.nannyRetryHandler = createRetryHandler({maxRequestRetry: 5, maxOtherRetry: 1}, this.logger);
        this.managerRetryHandler = createRetryHandler({maxRequestRetry: 5, maxOtherRetry: 10, waitOnRetry: false, clearRetryCountAfter: 2}, this.logger);

        this.stagger = stagger ?? 2000;

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

        const modStreamListingListener = (name: string) => async (listing: (Comment|Submission)[]) => {
            // dole out in order they were received
            if(!this.streamListedOnce.includes(name)) {
                this.streamListedOnce.push(name);
                return;
            }
            for(const i of listing) {
                const foundManager = this.subManagers.find(x => x.subreddit.display_name === i.subreddit.display_name && x.modStreamCallbacks.get(name) !== undefined);
                if(foundManager !== undefined) {
                    foundManager.modStreamCallbacks.get(name)(i);
                    if(stagger !== undefined) {
                        await sleep(stagger);
                    }
                }
            }

        }

        const defaultUnmoderatedStream = new UnmoderatedStream(this.client, {subreddit: 'mod', limit: 100, clearProcessed: { size: 100, retain: 100 }});
        // @ts-ignore
        defaultUnmoderatedStream.on('error', modStreamErrorListener('unmoderated'));
        defaultUnmoderatedStream.on('listing', modStreamListingListener('unmoderated'));
        const defaultModqueueStream = new ModQueueStream(this.client, {subreddit: 'mod', limit: 100, clearProcessed: { size: 100, retain: 100 }});
        // @ts-ignore
        defaultModqueueStream.on('error', modStreamErrorListener('modqueue'));
        defaultModqueueStream.on('listing', modStreamListingListener('modqueue'));
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

    async testClient(initial = true) {
        try {
            // @ts-ignore
            await this.client.getMe();
            this.logger.info('Test API call successful');
        } catch (err: any) {
            if (initial) {
                this.logger.error('An error occurred while trying to initialize the Reddit API Client which would prevent the entire application from running.');
            }
            if (err.name === 'StatusCodeError') {
                const authHeader = err.response.headers['www-authenticate'];
                if (authHeader !== undefined && authHeader.includes('insufficient_scope')) {
                    this.logger.error('Reddit responded with a 403 insufficient_scope. Please ensure you have chosen the correct scopes when authorizing your account.');
                } else if (err.statusCode === 401) {
                    this.logger.error('It is likely a credential is missing or incorrect. Check clientId, clientSecret, refreshToken, and accessToken');
                } else if(err.statusCode === 400) {
                    this.logger.error('Credentials may have been invalidated due to prior behavior. The error message may contain more information.');
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
        this.botAccount = `u/${user.name}`;
        this.logger.info(`Reddit API Limit Remaining: ${this.client.ratelimitRemaining}`);
        this.logger.info(`Authenticated Account: u/${user.name}`);

        const botNameFromConfig = this.botName !== undefined;
        if(this.botName === undefined) {
            this.botName = `u/${user.name}`;
        }
        this.logger.info(`Bot Name${botNameFromConfig ? ' (from config)' : ''}: ${this.botName}`);

        let subListing = await this.client.getModeratedSubreddits({count: 100});
        while(!subListing.isFinished) {
            subListing = await subListing.fetchMore({amount: 100});
        }
        availSubs = subListing;

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
            if(this.excludeSubreddits.length > 0) {
                this.logger.info(`Will run on all moderated subreddits but user-defined excluded: ${this.excludeSubreddits.join(', ')}`);
                const normalExcludes = this.excludeSubreddits.map(x => x.toLowerCase());
                subsToRun = availSubs.filter(x => !normalExcludes.includes(x.display_name.toLowerCase()));
            } else {
                this.logger.info(`No user-defined subreddit constraints detected, will run on all moderated subreddits EXCEPT own profile (${this.botAccount})`);
                subsToRun = availSubs.filter(x => x.display_name_prefixed !== this.botAccount);
            }
        }

        // get configs for subs we want to run on and build/validate them
        for (const sub of subsToRun) {
            try {
                this.subManagers.push(await this.createManager(sub));
            } catch (err: any) {

            }
        }
    }

    async createManager(sub: Subreddit): Promise<Manager> {
        const manager = new Manager(sub, this.client, this.logger, this.cacheManager, {dryRun: this.dryRun, sharedModqueue: this.sharedModqueue, wikiLocation: this.wikiLocation, botName: this.botName as string, maxWorkers: this.maxWorkers});
        try {
            await manager.parseConfiguration('system', true, {suppressNotification: true});
        } catch (err: any) {
            if (!(err instanceof LoggedError)) {
                this.logger.error(`Config was not valid:`, {subreddit: sub.display_name_prefixed});
                this.logger.error(err, {subreddit: sub.display_name_prefixed});
                err.logged = true;
            }
        }
        // all errors from managers will count towards bot-level retry count
        manager.on('error', async (err) => await this.panicOnRetries(err));
        return manager;
    }

    // if the cumulative errors exceeds configured threshold then stop ALL managers as there is most likely something very bad happening
    async panicOnRetries(err: any) {
        if(!this.managerRetryHandler(err)) {
            for(const m of this.subManagers) {
                await m.stop();
            }
        }
    }

    async destroy(causedBy: Invokee) {
        this.logger.info('Stopping heartbeat and nanny processes, may take up to 5 seconds...');
        const processWait = pEvent(this.emitter, 'healthStopped');
        this.running = false;
        await processWait;
        for (const manager of this.subManagers) {
            await manager.stop(causedBy, {reason: 'App rebuild'});
        }
        this.logger.info('Bot is stopped.');
    }

    async checkModInvites() {
        const subs: string[] = await this.cacheManager.getPendingSubredditInvites();
        for (const name of subs) {
            try {
                // @ts-ignore
                await this.client.getSubreddit(name).acceptModeratorInvite();
                this.logger.info(`Accepted moderator invite for r/${name}!`);
                await this.cacheManager.deletePendingSubredditInvite(name);
                // @ts-ignore
                const sub = await this.client.getSubreddit(name);
                this.logger.info(`Attempting to add manager for r/${name}`);
                try {
                    const manager = await this.createManager(sub);
                    this.logger.info(`Starting manager for r/${name}`);
                    this.subManagers.push(manager);
                    await manager.start('system', {reason: 'Caused by creation due to moderator invite'});
                    await this.runModStreams();
                } catch (err: any) {
                    if (!(err instanceof LoggedError)) {
                        this.logger.error(err);
                    }
                }
            } catch (err: any) {
                if (err.message.includes('NO_INVITE_FOUND')) {
                    this.logger.warn(`No pending moderation invite for r/${name} was found`);
                } else if (isStatusError(err) && err.statusCode === 403) {
                    this.logger.error(`Error occurred while checking r/${name} for a pending moderation invite. It is likely that this bot does not have the 'modself' oauth permission. Error: ${err.message}`);
                } else {
                    this.logger.error(`Error occurred while checking r/${name} for a pending moderation invite. Error: ${err.message}`);
                }
            }
        }
    }

    async runModStreams(notify = false) {
        for(const [k,v] of this.cacheManager.modStreams) {
            if(!v.running && this.subManagers.some(x => x.modStreamCallbacks.get(k) !== undefined)) {
                v.startInterval();
                this.logger.info(`Starting default ${k.toUpperCase()} mod stream`);
                if(notify) {
                    for(const m of this.subManagers) {
                        if(m.modStreamCallbacks.size > 0) {
                            await m.notificationManager.handle('runStateChanged', `${k.toUpperCase()} Polling Started`, 'Polling was successfully restarted on heartbeat.');
                        }
                    }
                }
                await sleep(2000);
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
                await sleep(this.stagger);
            }
        }

        await this.runModStreams();

        this.running = true;
        this.nextNannyCheck = dayjs().add(10, 'second');
        this.nextHeartbeat = dayjs().add(this.heartbeatInterval, 'second');
        await this.checkModInvites();
        await this.healthLoop();
    }

    async healthLoop() {
        while (this.running) {
            await sleep(5000);
            if (!this.running) {
                break;
            }
            if (dayjs().isSameOrAfter(this.nextNannyCheck)) {
                try {
                    await this.runApiNanny();
                    this.nextNannyCheck = dayjs().add(10, 'second');
                } catch (err: any) {
                    this.logger.info('Delaying next nanny check for 2 minutes due to emitted error');
                    this.nextNannyCheck = dayjs().add(120, 'second');
                }
            }
            if(dayjs().isSameOrAfter(this.nextHeartbeat)) {
                try {
                    await this.heartbeat();
                    await this.checkModInvites();
                } catch (err: any) {
                    this.logger.error(`Error occurred during heartbeat check: ${err.message}`);
                }
                this.nextHeartbeat = dayjs().add(this.heartbeatInterval, 'second');
            }
        }
        this.emitter.emit('healthStopped');
    }

    async heartbeat() {
        const heartbeat = `HEARTBEAT -- API Remaining: ${this.client.ratelimitRemaining} | Usage Rolling Avg: ~${formatNumber(this.apiRollingAvg)}/s | Est Depletion: ${this.apiEstDepletion === undefined ? 'N/A' : this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`
        this.logger.info(heartbeat);

        // run sanity check to see if there is a service issue
        try {
            await this.testClient(false);
        } catch (err: any) {
            throw new SimpleError(`Something isn't right! This could be a Reddit API issue (service is down? buggy??) or an issue with the Bot account. Will not run heartbeat operations and will wait until next heartbeat (${dayjs.duration(this.nextHeartbeat.diff(dayjs())).humanize()}) to try again`);
        }
        let startedAny = false;

        for (const s of this.subManagers) {
            if(s.botState.state === STOPPED && s.botState.causedBy === USER) {
                this.logger.debug('Skipping config check/restart on heartbeat due to previously being stopped by user', {subreddit: s.displayLabel});
                continue;
            }
            try {
                // ensure calls to wiki page are also staggered so we aren't hitting api hard when bot has a ton of subreddits to check
                await sleep(this.stagger);
                const newConfig = await s.parseConfiguration();
                const willStart = newConfig || (s.queueState.state !== RUNNING && s.queueState.causedBy === SYSTEM) || (s.eventsState.state !== RUNNING && s.eventsState.causedBy === SYSTEM);
                if(willStart) {
                    // stagger restart
                    if (startedAny) {
                        await sleep(this.stagger);
                    }
                    startedAny = true;
                    if(newConfig || (s.queueState.state !== RUNNING && s.queueState.causedBy === SYSTEM))
                    {
                        await s.startQueue('system', {reason: newConfig ? 'Config updated on heartbeat triggered reload' : 'Heartbeat detected non-running queue'});
                    }
                    if(newConfig || (s.eventsState.state !== RUNNING && s.eventsState.causedBy === SYSTEM))
                    {
                        await s.startEvents('system', {reason: newConfig ? 'Config updated on heartbeat triggered reload' : 'Heartbeat detected non-running events'});
                    }
                }
                if(s.botState.state !== RUNNING && s.eventsState.state === RUNNING && s.queueState.state === RUNNING) {
                    s.botState = {
                        state: RUNNING,
                        causedBy: 'system',
                    }
                }
            } catch (err: any) {
                this.logger.info('Stopping event polling to prevent activity processing queue from backing up. Will be restarted when config update succeeds.')
                await s.stopEvents('system', {reason: 'Invalid config will cause events to pile up in queue. Will be restarted when config update succeeds (next heartbeat).'});
                if(!(err instanceof LoggedError)) {
                    this.logger.error(err, {subreddit: s.displayLabel});
                }
                if(this.nextHeartbeat !== undefined) {
                    this.logger.info(`Will retry parsing config on next heartbeat (in ${dayjs.duration(this.nextHeartbeat.diff(dayjs())).humanize()})`, {subreddit: s.displayLabel});
                }
            }
        }
        await this.runModStreams(true);
    }

    async runApiNanny() {
        try {
            this.nextExpiration = dayjs(this.client.ratelimitExpiration);
            const nowish = dayjs().add(10, 'second');
            if (nowish.isAfter(this.nextExpiration)) {
                // it's possible no api calls are being made because of a hard limit
                // need to make an api call to update this
                let shouldRetry = true;
                while (shouldRetry) {
                    try {
                        // @ts-ignore
                        await this.client.getMe();
                        shouldRetry = false;
                    } catch (err: any) {
                        if(isRateLimitError(err)) {
                            throw err;
                        }
                        shouldRetry = await this.nannyRetryHandler(err);
                        if (!shouldRetry) {
                            throw err;
                        }
                    }
                }
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
                    return;
                }
                this.logger.info(`Detected HARD LIMIT of ${this.hardLimit} remaining`, {leaf: 'Api Nanny'});
                this.logger.info(`API Remaining: ${this.client.ratelimitRemaining} | Usage Rolling Avg: ${this.apiRollingAvg}/s | Est Depletion: ${this.apiEstDepletion.humanize()} (${formatNumber(this.depletedInSecs, {toFixed: 0})} seconds)`, {leaf: 'Api Nanny'});
                this.logger.info(`All subreddit event polling has been paused`, {leaf: 'Api Nanny'});

                for (const m of this.subManagers) {
                    m.pauseEvents('system');
                    m.notificationManager.handle('runStateChanged', 'Hard Limit Triggered', `Hard Limit of ${this.hardLimit} hit (API Remaining: ${this.client.ratelimitRemaining}). Subreddit event polling has been paused.`, 'system', 'warn');
                }

                this.nannyMode = 'hard';
                return;
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
                    return;
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
                return
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

        } catch (err: any) {
            this.logger.error(`Error occurred during nanny loop: ${err.message}`);
            throw err;
        }
    }
}

export default Bot;
