import Snoowrap, {Comment, ConfigOptions, RedditUser, Submission, Subreddit} from "snoowrap";
import {Logger} from "winston";
import dayjs, {Dayjs} from "dayjs";
import {Duration} from "dayjs/plugin/duration";
import EventEmitter from "events";
import {
    BotInstanceConfig, DatabaseStatisticsOperatorConfig,
    LogInfo,
    PAUSED,
    RUNNING,
    STOPPED,
    SYSTEM,
    USER
} from "../Common/interfaces";
import {
    createRetryHandler, difference,
    formatNumber, getExceptionMessage, getUserAgent,
    mergeArr,
    parseBool,
    parseDuration, parseMatchMessage, parseRedditEntity,
    parseSubredditName, RetryOptions,
    sleep
} from "../util";
import {Manager} from "../Subreddit/Manager";
import {ExtendedSnoowrap, ProxiedSnoowrap} from "../Utils/SnoowrapClients";
import {CommentStream, ModQueueStream, SPoll, SubmissionStream, UnmoderatedStream} from "../Subreddit/Streams";
import {BotResourcesManager} from "../Subreddit/SubredditResources";
import LoggedError from "../Utils/LoggedError";
import pEvent from "p-event";
import {SimpleError, isRateLimitError, isRequestError, isScopeError, isStatusError, CMError} from "../Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {DataSource, Repository} from "typeorm";
import {Bot as BotEntity} from '../Common/Entities/Bot';
import {ManagerEntity as ManagerEntity} from '../Common/Entities/ManagerEntity';
import {Subreddit as SubredditEntity} from '../Common/Entities/Subreddit';
import {InvokeeType} from "../Common/Entities/InvokeeType";
import {RunStateType} from "../Common/Entities/RunStateType";
import {QueueRunState} from "../Common/Entities/EntityRunState/QueueRunState";
import {EventsRunState} from "../Common/Entities/EntityRunState/EventsRunState";
import {ManagerRunState} from "../Common/Entities/EntityRunState/ManagerRunState";
import {Invokee, PollOn} from "../Common/Infrastructure/Atomic";
import {FilterCriteriaDefaults} from "../Common/Infrastructure/Filters/FilterShapes";
import {snooLogWrapper} from "../Utils/loggerFactory";

class Bot {

    client!: ExtendedSnoowrap;
    logger!: Logger;
    logs: LogInfo[] = [];
    wikiLocation: string;
    dryRun?: true | undefined;
    running: boolean = false;
    subreddits: string[];
    excludeSubreddits: string[];
    filterCriteriaDefaults?: FilterCriteriaDefaults
    subManagers: Manager[] = [];
    heartbeatInterval: number;
    nextHeartbeat: Dayjs = dayjs();
    heartBeating: boolean = false;

    softLimit: number | string = 250;
    hardLimit: number | string = 50;
    nannyMode?: 'soft' | 'hard';
    nannyRunning: boolean = false;
    nextNannyCheck: Dayjs = dayjs().add(10, 'second');
    sharedStreamRetryHandler: Function;
    nannyRetryHandler: Function;
    managerRetryHandler: Function;
    nextExpiration: Dayjs = dayjs();
    nextRetentionCheck: Dayjs = dayjs();
    botName?: string;
    botLink?: string;
    botAccount?: string;
    maxWorkers: number;
    startedAt: Dayjs = dayjs();
    sharedStreams: PollOn[] = [];
    streamListedOnce: string[] = [];

    stagger: number;

    apiSample: number[] = [];
    apiRollingAvg: number = 0;
    apiEstDepletion?: Duration;
    depletedInSecs: number = 0;

    error: any;
    emitter: EventEmitter = new EventEmitter();

    cacheManager: BotResourcesManager;

    config: BotInstanceConfig;

    database: DataSource
    invokeeRepo: Repository<InvokeeType>;
    runTypeRepo: Repository<RunStateType>;
    botEntity!: BotEntity

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
            filterCriteriaDefaults,
            subreddits: {
                names = [],
                exclude = [],
                wikiConfig,
                dryRun,
                heartbeatInterval,
            },
            userAgent,
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
                maxRetryAttempts = 2,
                retryErrorCodes,
                timeoutCodes,
            },
            polling: {
                shared = [],
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
            },
            database,
        } = config;

        this.database = database;
        this.invokeeRepo = this.database.getRepository(InvokeeType);
        this.runTypeRepo = this.database.getRepository(RunStateType);
        this.config = config;
        this.dryRun = parseBool(dryRun) === true ? true : undefined;
        this.softLimit = softLimit;
        this.hardLimit = hardLimit;
        this.wikiLocation = wikiConfig;
        this.heartbeatInterval = heartbeatInterval;
        this.filterCriteriaDefaults = filterCriteriaDefaults;
        this.sharedStreams = shared;
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

        this.logger.stream().on('log', (log: LogInfo) => {
            if(log.bot !== undefined && log.bot === this.getBotName() && log.subreddit === undefined) {
                const combinedLogs = [log, ...this.logs];
                this.logs = combinedLogs.slice(0, 301);
            }
        });

        this.cacheManager = new BotResourcesManager(config, this.logger);

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
            get userAgent() {
                return getUserAgent(`web:contextBot:{VERSION}{FRAG}:BOT-${getBotName()}`, userAgent)
            },
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
            this.client = proxy === undefined ? new ExtendedSnoowrap({...creds, timeoutCodes}) : new ProxiedSnoowrap({...creds, proxy, timeoutCodes});
            const snoowrapConfigData: ConfigOptions = {
                warnings: true,
                maxRetryAttempts,
                debug,
                logger: snooLogWrapper(this.logger.child({labels: ['Snoowrap']}, mergeArr)),
                continueAfterRatelimitError: false,
            };

            if(retryErrorCodes !== undefined) {
                snoowrapConfigData.retryErrorCodes = retryErrorCodes;
            }

            this.client.config(snoowrapConfigData);
        } catch (err: any) {
            if(this.error === undefined) {
                this.error = err.message;
                this.logger.error(err);
            }
        }

        this.sharedStreamRetryHandler = createRetryHandler({maxRequestRetry: 8, maxOtherRetry: 2}, this.logger);
        this.nannyRetryHandler = createRetryHandler({maxRequestRetry: 5, maxOtherRetry: 1}, this.logger);
        this.managerRetryHandler = createRetryHandler({maxRequestRetry: 8, maxOtherRetry: 8, waitOnRetry: false, clearRetryCountAfter: 2}, this.logger);

        this.stagger = stagger ?? 2000;

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

    createSharedStreamErrorListener = (name: string) => async (err: any) => {
        const shouldRetry = await this.sharedStreamRetryHandler(err);
        if(shouldRetry) {
            (this.cacheManager.modStreams.get(name) as SPoll<any>).startInterval(false, 'Within retry limits');
        } else {
            for(const m of this.subManagers) {
                if(m.sharedStreamCallbacks.size > 0) {
                    m.notificationManager.handle('runStateChanged', `${name.toUpperCase()} Polling Stopped`, 'Encountered too many errors from Reddit while polling. Will try to restart on next heartbeat.');
                }
            }
            this.logger.error(`Mod stream ${name.toUpperCase()} encountered too many errors while polling. Will try to restart on next heartbeat.`);
        }
    }

    createSharedStreamListingListener = (name: string) => async (listing: (Comment|Submission)[]) => {
        // dole out in order they were received
        if(!this.streamListedOnce.includes(name)) {
            this.streamListedOnce.push(name);
            return;
        }
        for(const i of listing) {
            const foundManager = this.subManagers.find(x => x.subreddit.display_name === i.subreddit.display_name && x.sharedStreamCallbacks.get(name) !== undefined && x.eventsState.state === RUNNING);
            if(foundManager !== undefined) {
                foundManager.sharedStreamCallbacks.get(name)(i);
                if(this.stagger !== undefined) {
                    await sleep(this.stagger);
                }
            }
        }
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
            const hint = getExceptionMessage(err, {
                401: 'Likely a credential is missing or incorrect. Check clientId, clientSecret, refreshToken, and accessToken',
                400: 'Credentials may have been invalidated manually or by reddit due to behavior',
            });
            let msg = `Error occurred while testing Reddit API client${hint !== undefined ? `: ${hint}` : ''}`;
            this.error = msg;
            const clientError = new CMError(msg, {cause: err});
            clientError.logged = true;
            this.logger.error(clientError);
            throw clientError;
        }
    }

    async buildManagers(subreddits: string[] = []) {
        let availSubs = [];
        // @ts-ignore
        const user = await this.client.getMe().fetch();
        this.cacheManager.botName = user.name;
        this.botLink = `https://reddit.com/user/${user.name}`;
        this.botAccount = `u/${user.name}`;
        this.logger.info(`Reddit API Limit Remaining: ${this.client.ratelimitRemaining}`);
        this.logger.info(`Authenticated Account: u/${user.name}`);

        if(this.cacheManager !== undefined) {
            this.cacheManager.botAccount = user.name;
        }

        const botNameFromConfig = this.botName !== undefined;
        if(this.botName === undefined) {
            this.botName = `u/${user.name}`;
        }
        this.logger.info(`Bot Name${botNameFromConfig ? ' (from config)' : ''}: ${this.botName}`);

        const botRepo = this.database.getRepository(BotEntity);

        let b = await botRepo.findOne({where: {name: this.botName}});
        if(b === undefined || b === null) {
            b = new BotEntity();
            b.name = this.botName;
            this.botEntity = await botRepo.save(b);
        } else {
            this.botEntity = b;
        }

        let subListing = await this.client.getModeratedSubreddits({count: 100});
        while(!subListing.isFinished) {
            subListing = await subListing.fetchMore({amount: 100});
        }
        availSubs = subListing.filter(x => x.display_name !== `u_${user.name}`);

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
                this.logger.info(`Will run on all moderated subreddits but own profile and user-defined excluded: ${this.excludeSubreddits.join(', ')}`);
                const normalExcludes = this.excludeSubreddits.map(x => x.toLowerCase());
                subsToRun = availSubs.filter(x => !normalExcludes.includes(x.display_name.toLowerCase()));
            } else {
                this.logger.info(`No user-defined subreddit constraints detected, will run on all moderated subreddits EXCEPT own profile (${this.botAccount})`);
                subsToRun = availSubs;
            }
        }

        const {
            subreddits: {
                overrides = [],
            } = {}
        } = this.config;
        if(overrides.length > 0) {
            // check for overrides that don't match subs to run and warn operator
            const subsToRunNames = subsToRun.map(x => x.display_name.toLowerCase());

            const normalizedOverrideNames = overrides.reduce((acc: string[], curr) => {
                try {
                    const ent = parseRedditEntity(curr.name);
                    return acc.concat(ent.name.toLowerCase());
                } catch (e) {
                    this.logger.warn(new ErrorWithCause(`Could not use subreddit override because name was not valid: ${curr.name}`, {cause: e}));
                    return acc;
                }
            }, []);
            const notMatched = difference(normalizedOverrideNames, subsToRunNames);
            if(notMatched.length > 0) {
                this.logger.warn(`There are overrides defined for subreddits the bot is not running. Check your spelling! Overrides not matched: ${notMatched.join(', ')}`);
            }
        }


        // get configs for subs we want to run on and build/validate them
        for (const sub of subsToRun) {
            try {
                this.subManagers.push(await this.createManager(sub));
            } catch (err: any) {

            }
        }
        for(const m of this.subManagers) {
            try {
                await this.initManager(m);
            } catch (err: any) {

            }
        }

        this.parseSharedStreams();
    }

    parseSharedStreams() {

        const sharedCommentsSubreddits = !this.sharedStreams.includes('newComm') ? [] : this.subManagers.filter(x => x.isPollingShared('newComm')).map(x => x.subreddit.display_name);
        if (sharedCommentsSubreddits.length > 0) {
            const stream = this.cacheManager.modStreams.get('newComm');
            if (stream === undefined || stream.subreddit !== sharedCommentsSubreddits.join('+')) {
                let processed;
                if (stream !== undefined) {
                    this.logger.info('Restarting SHARED COMMENT STREAM due to a subreddit config change');
                    stream.end('Replacing with a new stream with updated subreddits');
                    processed = stream.processed;
                }
                if (sharedCommentsSubreddits.length > 100) {
                    this.logger.warn(`SHARED COMMENT STREAM => Reddit can only combine 100 subreddits for getting new Comments but this bot has ${sharedCommentsSubreddits.length}`);
                }
                const defaultCommentStream = new CommentStream(this.client, {
                    subreddit: sharedCommentsSubreddits.join('+'),
                    limit: 100,
                    enforceContinuity: true,
                    logger: this.logger,
                    processed,
                    label: 'Shared Polling'
                });
                // @ts-ignore
                defaultCommentStream.on('error', this.createSharedStreamErrorListener('newComm'));
                defaultCommentStream.on('listing', this.createSharedStreamListingListener('newComm'));
                this.cacheManager.modStreams.set('newComm', defaultCommentStream);
            }
        } else {
            const stream = this.cacheManager.modStreams.get('newComm');
            if (stream !== undefined) {
                stream.end('Determined no managers are listening on shared stream parsing');
            }
        }

        const sharedSubmissionsSubreddits = !this.sharedStreams.includes('newSub') ? [] : this.subManagers.filter(x => x.isPollingShared('newSub')).map(x => x.subreddit.display_name);
        if (sharedSubmissionsSubreddits.length > 0) {
            const stream = this.cacheManager.modStreams.get('newSub');
            if (stream === undefined || stream.subreddit !== sharedSubmissionsSubreddits.join('+')) {
                let processed;
                if (stream !== undefined) {
                    this.logger.info('Restarting SHARED SUBMISSION STREAM due to a subreddit config change');
                    stream.end('Replacing with a new stream with updated subreddits');
                    processed = stream.processed;
                }
                if (sharedSubmissionsSubreddits.length > 100) {
                    this.logger.warn(`SHARED SUBMISSION STREAM => Reddit can only combine 100 subreddits for getting new Submissions but this bot has ${sharedSubmissionsSubreddits.length}`);
                }
                const defaultSubStream = new SubmissionStream(this.client, {
                    subreddit: sharedSubmissionsSubreddits.join('+'),
                    limit: 100,
                    enforceContinuity: true,
                    logger: this.logger,
                    processed,
                    label: 'Shared Polling'
                });
                // @ts-ignore
                defaultSubStream.on('error', this.createSharedStreamErrorListener('newSub'));
                defaultSubStream.on('listing', this.createSharedStreamListingListener('newSub'));
                this.cacheManager.modStreams.set('newSub', defaultSubStream);
            }
        } else {
            const stream = this.cacheManager.modStreams.get('newSub');
            if (stream !== undefined) {
                stream.end('Determined no managers are listening on shared stream parsing');
            }
        }

        const isUnmoderatedShared = !this.sharedStreams.includes('unmoderated') ? false : this.subManagers.some(x => x.isPollingShared('unmoderated'));
        const unmoderatedstream = this.cacheManager.modStreams.get('unmoderated');
        if (isUnmoderatedShared && unmoderatedstream === undefined) {
            const defaultUnmoderatedStream = new UnmoderatedStream(this.client, {
                subreddit: 'mod',
                limit: 100,
                logger: this.logger,
                label: 'Shared Polling'
            });
            // @ts-ignore
            defaultUnmoderatedStream.on('error', this.createSharedStreamErrorListener('unmoderated'));
            defaultUnmoderatedStream.on('listing', this.createSharedStreamListingListener('unmoderated'));
            this.cacheManager.modStreams.set('unmoderated', defaultUnmoderatedStream);
        } else if (!isUnmoderatedShared && unmoderatedstream !== undefined) {
            unmoderatedstream.end('Determined no managers are listening on shared stream parsing');
        }

        const isModqueueShared = !this.sharedStreams.includes('modqueue') ? false : this.subManagers.some(x => x.isPollingShared('modqueue'));
        const modqueuestream = this.cacheManager.modStreams.get('modqueue');
        if (isModqueueShared && modqueuestream === undefined) {
            const defaultModqueueStream = new ModQueueStream(this.client, {
                subreddit: 'mod',
                limit: 100,
                logger: this.logger,
                label: 'Shared Polling'
            });
            // @ts-ignore
            defaultModqueueStream.on('error', this.createSharedStreamErrorListener('modqueue'));
            defaultModqueueStream.on('listing', this.createSharedStreamListingListener('modqueue'));
            this.cacheManager.modStreams.set('modqueue', defaultModqueueStream);
        } else if (isModqueueShared && modqueuestream !== undefined) {
            modqueuestream.end('Determined no managers are listening on shared stream parsing');
        }
    }

    async initManager(manager: Manager) {
        try {
            await manager.syncRunningStates();
            await manager.parseConfiguration('system', true, {suppressNotification: true, suppressChangeEvent: true});
        } catch (err: any) {
            if(err.logged !== true) {
                const normalizedError = new ErrorWithCause(`Bot could not initialize manager because config was not valid`, {cause: err});
                // @ts-ignore
                this.logger.error(normalizedError, {subreddit: manager.subreddit.display_name_prefixed});
            } else {
                this.logger.error('Bot could not initialize manager because config was not valid', {subreddit: manager.subreddit.display_name_prefixed});
            }
        }
    }

    async createManager(sub: Subreddit): Promise<Manager> {
        const {
            flowControlDefaults: {
                maxGotoDepth: botMaxDefault
            } = {},
            databaseStatisticsDefaults,
            subreddits: {
                overrides = [],
            } = {}
        } = this.config;

        const override = overrides.find(x => {
            const configName = parseRedditEntity(x.name).name;
            if(configName !== undefined) {
                return configName.toLowerCase() === sub.display_name.toLowerCase();
            }
            return false;
        });

        const {
            flowControlDefaults: {
                maxGotoDepth: subMax = undefined,
            } = {},
            databaseStatisticsDefaults: statDefaultsFromOverride,
            databaseConfig: {
                retention = undefined
            } = {},
        } = override || {};

        const managerRepo = this.database.getRepository(ManagerEntity);
        const subRepo = this.database.getRepository(SubredditEntity)
        let subreddit = await subRepo.findOne({where: {id: sub.name}});
        if(subreddit === null) {
            subreddit = await subRepo.save(new SubredditEntity({id: sub.name, name: sub.display_name}))
        }
        let managerEntity = await managerRepo.findOne({
            where: {
                bot: {
                    id: this.botEntity.id
                },
                subreddit: {
                    id: subreddit.id
                }
            },
        });
        if(managerEntity === undefined || managerEntity === null) {
            const invokee = await this.invokeeRepo.findOneBy({name: SYSTEM}) as InvokeeType;
            const runType = await this.runTypeRepo.findOneBy({name: STOPPED}) as RunStateType;

            managerEntity = await managerRepo.save(new ManagerEntity({
                name: sub.display_name,
                bot: this.botEntity,
                subreddit: subreddit as SubredditEntity,
                queueState: new QueueRunState({invokee, runType}),
                eventsState: new EventsRunState({invokee, runType}),
                managerState: new ManagerRunState({invokee, runType})
            }));
        }

        const manager = new Manager(sub, this.client, this.logger, this.cacheManager, {
            dryRun: this.dryRun,
            sharedStreams: this.sharedStreams,
            wikiLocation: this.wikiLocation,
            botName: this.botName as string,
            maxWorkers: this.maxWorkers,
            filterCriteriaDefaults: this.filterCriteriaDefaults,
            maxGotoDepth: subMax ?? botMaxDefault,
            botEntity: this.botEntity,
            managerEntity: managerEntity as ManagerEntity,
            statDefaults: (statDefaultsFromOverride ?? databaseStatisticsDefaults) as DatabaseStatisticsOperatorConfig,
            retention,
        });
        // all errors from managers will count towards bot-level retry count
        manager.on('error', async (err) => await this.panicOnRetries(err));
        manager.on('configChange', async () => {
           this.parseSharedStreams();
           await this.runSharedStreams(false);
        });
        return manager;
    }

    // if the cumulative errors exceeds configured threshold then stop ALL managers as there is most likely something very bad happening
    async panicOnRetries(err: any) {
        if(!await this.managerRetryHandler(err)) {
            this.logger.warn('Bot detected too many errors from managers within a short time. Stopping all managers and will try to restart on next heartbeat.');
            for(const m of this.subManagers) {
                await m.stop('system',{reason: 'Bot detected too many errors from all managers. Stopping all manager as a failsafe.'});
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
                    const manager =  await this.createManager(sub);
                    this.logger.info(`Starting manager for r/${name}`);
                    this.subManagers.push(manager);
                    await this.initManager(manager);
                    await manager.start('system', {reason: 'Caused by creation due to moderator invite'});
                    await this.runSharedStreams();
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

    async runSharedStreams(notify = false) {
        for(const [k,v] of this.cacheManager.modStreams) {
            if(!v.running && this.subManagers.some(x => x.sharedStreamCallbacks.get(k) !== undefined)) {
                v.startInterval();
                this.logger.info(`Starting ${k.toUpperCase()} shared polling`);
                if(notify) {
                    for(const m of this.subManagers) {
                        if(m.sharedStreamCallbacks.size > 0) {
                            await m.notificationManager.handle('runStateChanged', `${k.toUpperCase()} Polling Started`, 'Polling was successfully restarted on heartbeat.');
                        }
                    }
                }
                await sleep(2000);
            }
        }
    }

    async runManagers(causedBy: Invokee = 'system') {
        this.running = true;

        if(this.subManagers.every(x => !x.validConfigLoaded)) {
            this.logger.warn('All managers have invalid configs!');
            this.error = 'All managers have invalid configs';
        }
        for (const manager of this.subManagers) {
            if (manager.validConfigLoaded && manager.managerState.state !== RUNNING) {
                if(manager.managerState.causedBy === USER) {
                    manager.logger.info('NOT starting automatically manager because last known state was caused by user input. Manager must be started manually by user.');
                } else {
                    await manager.start(causedBy, {reason: 'Caused by application startup'});
                }
                await sleep(this.stagger);
            }
        }

        await this.runSharedStreams();

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
            const now = dayjs();
            if (now.isSameOrAfter(this.nextNannyCheck)) {
                try {
                    await this.runApiNanny();
                    this.nextNannyCheck = dayjs().add(10, 'second');
                } catch (err: any) {
                    this.logger.info('Delaying next nanny check for 4 minutes due to emitted error');
                    this.nextNannyCheck = dayjs().add(240, 'second');
                }
            }
            if(now.isSameOrAfter(this.nextHeartbeat)) {
                try {
                    await this.heartbeat();
                    await this.checkModInvites();
                } catch (err: any) {
                    this.logger.error(`Error occurred during heartbeat check: ${err.message}`);
                }
                this.nextHeartbeat = dayjs().add(this.heartbeatInterval, 'second');
            }
            // run without awaiting as we don't know how long this might take and we don't want to pause the whole healthloop for it
            this.retentionCleanup();
        }
        this.emitter.emit('healthStopped');
    }

    async retentionCleanup() {
        const now = dayjs();
        if(now.isSameOrAfter(this.nextRetentionCheck)) {
            this.nextRetentionCheck = dayjs().add(30, 'minute');
            for(const m of this.subManagers) {
                if(m.resources !== undefined) {
                    await m.resources.retentionCleanup();
                }
            }
        }
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
            if(s.managerState.state === STOPPED && s.managerState.causedBy === USER) {
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
                if(s.managerState.state !== RUNNING && s.eventsState.state === RUNNING && s.queueState.state === RUNNING) {
                    s.managerState = {
                        state: RUNNING,
                        causedBy: 'system',
                    }
                    await s.syncRunningState('managerState');
                }
            } catch (err: any) {
                if(s.eventsState.state === RUNNING) {
                    this.logger.info('Stopping event polling to prevent activity processing queue from backing up. Will be restarted when config update succeeds.')
                    await s.stopEvents('system', {reason: 'Invalid config will cause events to pile up in queue. Will be restarted when config update succeeds (next heartbeat).'});
                }
                if(err.logged !== true) {
                    this.logger.error(err, {subreddit: s.displayLabel});
                }
                if(this.nextHeartbeat !== undefined) {
                    this.logger.info(`Will retry parsing config on next heartbeat (in ${dayjs.duration(this.nextHeartbeat.diff(dayjs())).humanize()})`, {subreddit: s.displayLabel});
                }
            }
        }
        await this.runSharedStreams(true);
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

                for(const [k,v] of this.cacheManager.modStreams) {
                    v.end('Hard limit cutoff');
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
                await this.runSharedStreams(true);
                this.nannyMode = undefined;
            }

        } catch (err: any) {
            this.logger.error(`Error occurred during nanny loop: ${err.message}`);
            throw err;
        }
    }
}

export default Bot;
