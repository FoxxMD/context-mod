import {addAsync, Router} from "@awaitjs/express";
import express, {Request, Response} from "express";
import bodyParser from "body-parser";
import cookieParser from 'cookie-parser';
// @ts-ignore
import CacheManagerStore from 'express-session-cache-manager'
import passport from 'passport';
import {Strategy as CustomStrategy} from 'passport-custom';
import {
    OperatorConfig,
    BotConnection,
    LogInfo,
    CheckSummary,
    RunResult,
    ActionedEvent,
    ActionResult, RuleResult, EventActivity
} from "../../Common/interfaces";
import {
    buildCachePrefix,
    createCacheManager, defaultFormat, filterLogBySubreddit, filterCriteriaSummary, formatFilterData,
    formatLogLineToHtml, filterLogs, getUserAgent,
    intersect, isLogLineMinLevel,
    LogEntry, parseInstanceLogInfoName, parseInstanceLogName, parseRedditEntity,
    parseSubredditLogName, permissions,
    randomId, replaceApplicationIdentifier, resultsSummary, sleep, triggeredIndicator, truncateStringToLength
} from "../../util";
import {Cache} from "cache-manager";
import session, {Session, SessionData} from "express-session";
import Snoowrap, {Subreddit} from "snoowrap";
import {getLogger} from "../../Utils/loggerFactory";
import EventEmitter from "events";
import tcpUsed from "tcp-port-used";
import http from "http";
import jwt from 'jsonwebtoken';
import {Server as SocketServer} from "socket.io";
import got from 'got';
import sharedSession from "express-socket.io-session";
import dayjs from "dayjs";
import httpProxy from 'http-proxy';
import {arrayMiddle, booleanMiddle} from "../Common/middleware";
import { URL } from "url";
import {MESSAGE} from "triple-beam";
import Autolinker from "autolinker";
import path from "path";
import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import ClientUser from "../Common/User/ClientUser";
import {SimpleError} from "../../Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {CMInstance} from "./CMInstance";
import {CMEvent} from "../../Common/Entities/CMEvent";
import { RulePremise } from "../../Common/Entities/RulePremise";
import { ActionPremise } from "../../Common/Entities/ActionPremise";
import {CacheStorageProvider, DatabaseStorageProvider} from "./StorageProvider";
import {nanoid} from "nanoid";
import {MigrationService} from "../../Common/MigrationService";
import {RuleResultEntity} from "../../Common/Entities/RuleResultEntity";
import {RuleSetResultEntity} from "../../Common/Entities/RuleSetResultEntity";
import { PaginationAwareObject } from "../Common/util";
import {BotInstance, BotStatusResponse, CMInstanceInterface} from "../Common/interfaces";

const emitter = new EventEmitter();

const app = addAsync(express());
const jsonParser = bodyParser.json();

const contentLinkingOptions = {
    urls: false,
    email: false,
    phone: false,
    mention: false,
    hashtag: false,
    stripPrefix: false,
    sanitizeHtml: true,
};

// do not modify body if we are proxying it to server
app.use((req, res, next) => {
    if(req.url.indexOf('/api') !== 0) {
        jsonParser(req, res, next);
    } else {
        next();
    }
});

const staticHeaders = (res: express.Response, path: string, stat: object) => {
    res.setHeader('X-Robots-Tag', 'noindex');
}
const staticOpts = {
    setHeaders: staticHeaders
}

app.use(bodyParser.urlencoded({extended: false}));
//app.use(cookieParser());
app.set('views', `${__dirname}/../assets/views`);
app.set('view engine', 'ejs');
app.use('/public', express.static(`${__dirname}/../assets/public`, staticOpts));
app.use('/monaco', express.static(`${__dirname}/../../../node_modules/monaco-editor/`, staticOpts));
app.use('/schemas', express.static(`${__dirname}/../../Schema/`, staticOpts));

app.use((req, res, next) => {
    // https://developers.google.com/search/docs/advanced/crawling/block-indexing#http-response-header
    res.setHeader('X-Robots-Tag', 'noindex');
    next();
});

const userAgent = `web:contextBot:web`;

const proxy = httpProxy.createProxyServer({
    ws: true,
    //hostRewrite: true,
    changeOrigin: true,
});

declare module 'express-session' {
    interface SessionData {
        limit?: number,
        sort?: string,
        level?: string,
        state?: string,
        scope?: string[],
        botId?: string,
        authBotId?: string,
    }
}

interface ConnectedUserInfo {
    level?: string,
    user?: string,
    botId: string,
    logStream?: Promise<void>
    logAbort?: AbortController
    statInterval?: any,
}

interface ConnectUserObj {
    [key: string]: ConnectedUserInfo
}

const createToken = (bot: CMInstanceInterface, user?: Express.User | any, ) => {
    const payload = user !== undefined ? {...user, machine: false} : {machine: true};
    return jwt.sign({
        data: payload,
    }, bot.secret, {
        expiresIn: '1m'
    });
}

const peekTrunc = truncateStringToLength(200);

const availableLevels = ['error', 'warn', 'info', 'verbose', 'debug'];

let webLogs: LogInfo[] = [];

const webClient = async (options: OperatorConfig) => {
    const {
        operator: {
            name,
            display,
        },
        userAgent: uaFragment,
        // caching: {
        //     provider: caching
        // },
        web: {
            database,
            databaseConfig: {
                migrations
            },
            port,
            storage: webStorage = 'database',
            caching,
            invites: {
              maxAge: invitesMaxAge,
            },
            session: {
                secret: sessionSecretFromConfig,
                maxAge: sessionMaxAge,
                storage: sessionStorage = 'database',
            },
            maxLogs,
            clients,
            credentials: {
                clientId,
                clientSecret,
                redirectUri
            },
            operators = [],
        },
        //database
    } = options;

    let sessionSecretSynced = false;

    const userAgent = getUserAgent(`web:contextBot:{VERSION}{FRAG}:dashboard`, uaFragment);

    app.use((req, res, next) => {
        res.locals.applicationIdentifier = replaceApplicationIdentifier('{VERSION}{FRAG}', uaFragment);
        next();
    });

    const webOps = operators.map(x => x.toLowerCase());

    const logger = getLogger({defaultLabel: 'Web', ...options.logging}, 'Web');

    logger.stream().on('log', (log: LogInfo) => {
        emitter.emit('log', log);
        webLogs.unshift(log);
        if(webLogs.length > 200) {
            webLogs.splice(200);
        }
    });

    const migrationService = new MigrationService({
        type: 'web',
        logger,
        database,
        options: migrations
    });

    if (await tcpUsed.check(port)) {
        throw new SimpleError(`Specified port for web interface (${port}) is in use or not available. Cannot start web server.`);
    }

    logger.info('Initializing database...');
    let [ranMigrations, migrationBlocker] = await migrationService.initDatabase();

    app.use((req, res, next) => {

        if(!ranMigrations && (req.url === '/' || req.url.indexOf('database') === -1)) {
            return res.render('migrations', {
                type: 'web',
                ranMigrations: ranMigrations,
                migrationBlocker: migrationBlocker,
            });
        } else {
            next();
        }
    });

    const storage = webStorage === 'database' ? new DatabaseStorageProvider({database, invitesMaxAge, logger}) : new CacheStorageProvider({...caching, invitesMaxAge, logger});

    let sessionSecret: string;
    if (sessionSecretFromConfig !== undefined) {
        logger.debug('Using session secret defined in config');
        sessionSecret = sessionSecretFromConfig;
        sessionSecretSynced = true;
    } else {
        try {
            let persistedSecret = await storage.getSessionSecret();
            if (undefined === persistedSecret) {
                storage.logger.debug('No session secret found in storage, generating new session secret and saving...');
                sessionSecret = randomId();
                await storage.setSessionSecret(sessionSecret);
            } else {
                storage.logger.debug('Using session secret found in from storage')
                sessionSecret = persistedSecret;
            }
            sessionSecretSynced = true;
        } catch (e) {
            sessionSecret = randomId();
            storage.logger.warn(new ErrorWithCause('Falling back to a random ID for session secret', {cause: e}));
        }
    }

    const connectedUsers: ConnectUserObj = {};

    //<editor-fold desc=Session and Auth>
    /*
    * Session and Auth
    * */

    passport.serializeUser(async function (data: any, done) {
        const {user, subreddits, scope, token} = data;
        done(null, { subreddits: subreddits.map((x: Subreddit) => x.display_name), isOperator: webOps.includes(user.toLowerCase()), name: user, scope, token, tokenExpiresAt: dayjs().unix() + (60 * 60) });
    });

    passport.deserializeUser(async function (obj: any, done) {
        const user = new ClientUser(obj.name, obj.subreddits, {token: obj.token, scope: obj.scope, webOperator: obj.isOperator, tokenExpiresAt: obj.tokenExpiresAt});
        done(null, user);
    });

    passport.use('snoowrap', new CustomStrategy(
        async function (req, done) {
            const {error, code, state} = req.query as any;
            if (error !== undefined) {
                let errContent: string;
                switch (error) {
                    case 'access_denied':
                        errContent = 'You must <b>Allow</b> this application to connect in order to proceed.';
                        break;
                    default:
                        errContent = error;
                }
                return done(errContent);
            } else if (req.session.state !== state) {
                return done('Unexpected <b>state</b> value returned');
            }
            const client = await ExtendedSnoowrap.fromAuthCode({
                userAgent,
                clientId,
                clientSecret,
                redirectUri: redirectUri as string,
                code: code as string,
            });
            const user = await client.getMe().name as string;
            let subs = await client.getModeratedSubreddits({count: 100});
            while(!subs.isFinished) {
                subs = await subs.fetchMore({amount: 100});
            }
            io.to(req.session.id).emit('authStatus', {canSaveWiki: req.session.scope?.includes('wikiedit')});
            return done(null, {user, subreddits: subs, scope: req.session.scope, token: client.accessToken});
        }
    ));


    let sessionStoreProvider = storage;
    if(sessionStorage !== webStorage) {
        sessionStoreProvider = sessionStorage === 'database' ? new DatabaseStorageProvider({database, invitesMaxAge, logger, loggerLabels: ['Session']}) : new CacheStorageProvider({...caching, invitesMaxAge, logger, loggerLabels: ['Session']});
    }
    const sessionObj = session({
        cookie: {
            maxAge: sessionMaxAge * 1000,
        },
        store: sessionStoreProvider.createSessionStore(sessionStorage === 'database' ? {
            cleanupLimit: 2,
            ttl: sessionMaxAge
        } : {}),
        resave: false,
        saveUninitialized: false,
        secret: sessionSecret,
    });
    app.use(sessionObj);
    app.use(passport.initialize());
    app.use(passport.session());

    const ensureAuthenticated = async (req: express.Request, res: express.Response, next: Function) => {
        if (req.isAuthenticated()) {
            next();
        } else {
            return res.redirect('/login');
        }
    }

    const ensureAuthenticatedApi = async (req: express.Request, res: express.Response, next: Function) => {
        if (req.isAuthenticated()) {
            next();
        } else {
            return res.status(401).send('You must be logged in to access this route');
        }
    }

    const scopeMiddle = arrayMiddle(['scope']);
    const successMiddle = booleanMiddle([{name: 'closeOnSuccess', defaultVal: undefined, required: false}]);
    app.getAsync('/login', scopeMiddle, successMiddle, async (req, res, next) => {
        if (redirectUri === undefined) {
            return res.render('error', {error: `No <b>redirectUri</b> was specified through environmental variables or program argument. This must be provided in order to use the web interface.`});
        }
        const {query: { scope: reqScopes = [], closeOnSuccess } } = req;
        const scope = [...new Set(['identity', 'mysubreddits', ...(reqScopes as string[])])];
        req.session.state = randomId();
        req.session.scope = scope;
        // @ts-ignore
        if(closeOnSuccess === true) {
            // @ts-ignore
            req.session.closeOnSuccess = closeOnSuccess;
        }
        const authUrl = Snoowrap.getAuthUrl({
            clientId,
            scope: scope,
            redirectUri: redirectUri as string,
            permanent: false,
            state: req.session.state,
        });
        return res.redirect(authUrl);
    });

    const botCallback = async (req: express.Request, res: express.Response, next: Function) => {
        const {state, error, code} = req.query as any;
        if(state.includes('bot')) {
            if (error !== undefined || state !== req.session.state) {
                let errContent: string;
                switch (error) {
                    case 'access_denied':
                        errContent = 'You must <b>Allow</b> this application to connect in order to proceed.';
                        break;
                    default:
                        if(error === undefined && state !== req.session.state) {
                            errContent = 'state value was unexpected';
                        } else {
                            errContent = error;
                        }
                        break;
                }
                return res.render('error', {error: errContent});
            }
            // @ts-ignore
            const invite = await storage.inviteGet(req.session.inviteId);
            if(invite === undefined) {
                // @ts-ignore
                return res.render('error', {error: `Could not find invite with id ${req.session.inviteId}?? This should happen!`});
            }
            const client = await Snoowrap.fromAuthCode({
                userAgent,
                clientId: invite.clientId,
                clientSecret: invite.clientSecret,
                redirectUri: invite.redirectUri,
                code: code as string,
            });
            // @ts-ignore
            const user = await client.getMe();
            const userName = `u/${user.name}`;
            // @ts-ignore
            await storage.inviteDelete(req.session.inviteId);
            let data: any = {
                accessToken: client.accessToken,
                refreshToken: client.refreshToken,
                userName,
            };
            if(invite.instance !== undefined) {
                const bot = cmInstances.find(x => x.getName() === invite.instance);
                if(bot !== undefined) {
                    const botPayload: any = {
                        overwrite: invite.overwrite === true,
                        name: userName,
                        credentials: {
                            reddit: {
                                accessToken: client.accessToken,
                                refreshToken: client.refreshToken,
                                clientId: invite.clientId,
                                clientSecret: invite.clientSecret,
                            }
                        }
                    };
                    if(invite.subreddits !== undefined && invite.subreddits.length > 0) {
                        botPayload.subreddits =  {names: invite.subreddits};
                    }
                    const botAddResult: any = await addBot(bot, {name: invite.creator}, botPayload);
                    // stored
                    // success
                    data = {...data, ...botAddResult};
                    // @ts-ignore
                    req.session.destroy();
                    req.logout();
                }
            }
            return res.render('callback', data);
        } else {
            return next();
        }
    }

    app.getAsync(/.*callback$/, botCallback, (req: express.Request, res: express.Response, next: Function) => {
        passport.authenticate('snoowrap', (err, user, info) => {
            if(err !== null) {
                return res.render('error', {error: err});
            }
            return req.logIn(user, (e) => {
                // don't know why we'd get an error here but ¯\_(ツ)_/¯
                if(e !== undefined) {
                    return res.render('error', {error: err});
                }
                // @ts-ignore
                const useCloseRedir: boolean = req.session.closeOnSuccess as any
                // @ts-ignore
                delete req.session.closeOnSuccess;
                req.session.save((err) => {
                    if(useCloseRedir === true) {
                        return res.render('close');
                    } else {
                        return res.redirect('/');
                    }
                })
            });
        })(req, res, next);
    });

    app.getAsync('/logout', async (req, res) => {
        // @ts-ignore
        req.session.destroy();
        req.logout();
        res.send('Bye!');
    });

    let token = randomId();

    const helperAuthed = async (req: express.Request, res: express.Response, next: Function) => {

        if(!req.isAuthenticated()) {
            return res.render('error', {error: 'You must be logged in to access this route.'});
        }
        if(operators.length === 0) {
            return res.render('error', {error: '<div>You must be authenticated <b>and an Operator</b> to access this route but there are <b>no Operators specified in configuration.</b></div>' +
                    '<div>Refer to the <a href="https://github.com/FoxxMD/context-mod/blob/master/docs/operatorConfiguration.md">Operator Configuration Guide</a> to do this.</div>' +
                    '<div>TLDR:' +
                    '<div>Environment Variable: <span class="font-mono">OPERATOR=YourRedditUsername</span></div> ' +
                    '<div>or as an argument: <span class="font-mono">--operator YourRedditUsername</span></div>'});
        }
        // or if there is an operator and current user is operator
        if(req.user?.clientData?.webOperator) {
            return next();
        } else {
            return res.render('error', {error: 'You must be an <b>Operator</b> to access this route.'});
        }
    }

    app.getAsync('/auth/helper', helperAuthed, (req, res) => {
        return res.render('helper', {
            redirectUri,
            clientId,
            clientSecret,
            token: req.isAuthenticated() && req.user?.clientData?.webOperator ? token : undefined,
            instances: cmInstances.filter(x => req.user?.isInstanceOperator(x)).map(x => x.getName()),
        });
    });

    app.getAsync('/auth/invite', async (req, res) => {
        const {invite: inviteId} = req.query;

        if(inviteId === undefined) {
            return res.render('error', {error: '`invite` param is missing from URL'});
        }
        const invite = await storage.inviteGet(inviteId as string);
        if(invite === undefined || invite === null) {
            return res.render('error', {error: 'Invite with the given id does not exist'});
        }

        return res.render('invite', {
            permissions: JSON.stringify(invite.permissions || []),
            invite: inviteId,
        });
    });

    app.postAsync('/auth/create', helperAuthed, async (req: express.Request, res: express.Response) => {
        const {
            permissions,
            clientId: ci,
            clientSecret: ce,
            redirect: redir,
            instance,
            subreddits,
            code,
        } = req.body as any;

        const cid = ci || clientId;
        if(cid === undefined || cid.trim() === '') {
            return res.status(400).send('clientId is required');
        }

        const ced = ce || clientSecret;
        if(ced === undefined || ced.trim() === '') {
            return res.status(400).send('clientSecret is required');
        }

        if(redir === undefined || redir.trim() === '') {
            return res.status(400).send('redirectUrl is required');
        }

        const inviteId = code || nanoid(20);
        await storage.inviteCreate(inviteId, {
            permissions,
            clientId: (ci || clientId).trim(),
            clientSecret: (ce || clientSecret).trim(),
            redirectUri: redir.trim(),
            instance,
            subreddits: subreddits.trim() === '' ? [] : subreddits.split(',').map((x: string) => parseRedditEntity(x).name),
            creator: (req.user as Express.User).name,
        });
        return res.send(inviteId);
    });

    app.getAsync('/auth/init', async (req: express.Request, res: express.Response) => {
        const {invite: inviteId} = req.query;
        if(inviteId === undefined) {
            return res.render('error', {error: '`invite` param is missing from URL'});
        }
        const invite = await storage.inviteGet(inviteId as string);
        if(invite === undefined || invite === null) {
            return res.render('error', {error: 'Invite with the given id does not exist'});
        }

        req.session.state = `bot_${randomId()}`;
        // @ts-ignore
        req.session.inviteId = inviteId;

        const scope = Object.entries(invite.permissions).reduce((acc: string[], curr) => {
            const [k, v] = curr as unknown as [string, boolean];
            if(v) {
                return acc.concat(k);
            }
            return acc;
        },[]);

        const authUrl = Snoowrap.getAuthUrl({
            clientId: invite.clientId,
            // @ts-ignore
            clientSecret: invite.clientSecret,
            scope,
            // @ts-ignore
            redirectUri: invite.redirectUri.trim(),
            permanent: true,
            state: req.session.state
        });
        return res.redirect(authUrl);
    });

    //</editor-fold>

    const cmInstances: CMInstance[] = [];
    let init = false;
    const formatter = defaultFormat();

    let server: http.Server,
        io: SocketServer;

    try {
        server = await app.listen(port);
        io = new SocketServer(server);
    } catch (err: any) {
        throw new ErrorWithCause('[Web] Error occurred while initializing web or socket.io server', {cause: err});
    }
    logger.info(`Web UI started: http://localhost:${port}`, {label: ['Web']});

    const instanceWithPermissions = async (req: express.Request, res: express.Response, next: Function) => {
        delete req.session.botId;
        delete req.session.authBotId;

        const msg = 'Bot does not exist or you do not have permission to access it';
        const instance = cmInstances.find(x => x.getName() === req.query.instance);
        if (instance === undefined) {
            return res.status(404).render('error', {error: msg});
        }

        if (!req.user?.clientData?.webOperator && !req.user?.canAccessInstance(instance)) {
            return res.status(404).render('error', {error: msg});
        }

        if (req.params.subreddit !== undefined && !req.user?.isInstanceOperator(instance) && !req.user?.subreddits.includes(req.params.subreddit)) {
            return res.status(404).render('error', {error: msg});
        }
        req.instance = instance;
        req.session.botId = instance.getName();
        if(req.user?.canAccessInstance(instance)) {
            req.session.authBotId = instance.getName();
        }
        return next();
    }


    const botWithPermissions = (required: boolean = false, setDefault: boolean = false) => async (req: express.Request, res: express.Response, next: Function) => {

        const instance = req.instance;
        if(instance === undefined) {
            return res.status(401).send("Instance must be defined");
        }

        const msg = 'Bot does not exist or you do not have permission to access it';
        const botVal = req.query.bot as string;
        if(botVal === undefined && required) {
            return res.status(400).render('error', {error: `"bot" param must be defined`});
        }

        if(botVal !== undefined || setDefault) {

            let botInstance;
            if(botVal === undefined) {
                // find a bot they can access
                botInstance = instance.bots.find(x => req.user?.canAccessBot(x));
                if(botInstance !== undefined) {
                    req.query.bot = botInstance.botName;
                }
            } else {
                botInstance = instance.bots.find(x => x.botName === botVal);
            }

            if(botInstance === undefined) {
                return res.status(404).render('error', {error: msg});
            }

            if (!req.user?.clientData?.webOperator && !req.user?.canAccessBot(botInstance)) {
                return res.status(404).render('error', {error: msg});
            }

            if (req.params.subreddit !== undefined && !req.user?.isInstanceOperator(instance) && !req.user?.subreddits.includes(req.params.subreddit)) {
                return res.status(404).render('error', {error: msg});
            }
            req.bot = botInstance;
        }

        next();
    }

    const createUserToken = async (req: express.Request, res: express.Response, next: Function) => {
        req.token = createToken(req.instance as CMInstanceInterface, req.user);
        next();
    }

    const defaultSession = (req: express.Request, res: express.Response, next: Function) => {
        if(req.session.limit === undefined) {
            req.session.limit = 200;
            req.session.level = 'verbose';
            req.session.sort = 'descending';
            req.session.save();
        }
        // @ts-ignore
        connectedUsers[req.session.id] = {};
        next();
    }

    // const authenticatedRouter = Router();
    // authenticatedRouter.use([ensureAuthenticated, defaultSession]);
    // app.use(authenticatedRouter);
    //
    // const botUserRouter = Router();
    // botUserRouter.use([ensureAuthenticated, defaultSession, botWithPermissions, createUserToken]);
    // app.use(botUserRouter);

    // proxy.on('proxyReq', (req) => {
    //    logger.debug(`Got proxy request: ${req.path}`);
    // });
    // proxy.on('proxyRes', (proxyRes, req, res) => {
    //     logger.debug(`Got proxy response: ${res.statusCode} for ${req.url}`);
    // });

    app.useAsync('/api/', [ensureAuthenticatedApi, defaultSession, instanceWithPermissions, botWithPermissions(false), createUserToken], (req: express.Request, res: express.Response) => {
        req.headers.Authorization = `Bearer ${req.token}`

        const instance = req.instance as CMInstanceInterface;
        return proxy.web(req, res, {
            target: {
                protocol: instance.url.protocol,
                host: instance.url.hostname,
                port: instance.url.port,
            },
            prependPath: false,
            proxyTimeout: 11000,
        }, (e: any) => {
            logger.error(e);
            res.status(500).send();
        });
    });

    const defaultInstance = async (req: express.Request, res: express.Response, next: Function) => {
        if(req.query.instance === undefined) {
            if(cmInstances.length === 0) {
                return res.render('error', {error: 'There are no ContextMod instances defined for this web client!'});
            }
            const user = req.user as Express.User;

            const accessibleInstance = cmInstances.find(x => {
                if(x.operators.includes(user.name)) {
                    return true;
                }
                return x.bots.some(y => y.canUserAccessBot(user.name, user.subreddits));
            });

            if(accessibleInstance === undefined) {
                logger.warn(`User ${user.name} is not an operator and has no subreddits in common with any *running* bot instances. If you are sure they should have common subreddits then this client may not be able to access all defined CM servers or the bot may be offline.`, {user: user.name});
                return res.render('noAccess');
            }

            return res.redirect(`/?instance=${accessibleInstance.getName()}`);
        }
        const instance = cmInstances.find(x => x.getName() === req.query.instance);
        req.instance = instance;
        next();
    }

/*    const defaultSubreddit = async (req: express.Request, res: express.Response, next: Function) => {
        if(req.bot !== undefined && req.query.subreddit === undefined) {
            const firstAccessibleSub = req.bot.managers.find(x => req.user?.isInstanceOperator(req.instance) || req.user?.subreddits.includes(x));
            req.query.subreddit = firstAccessibleSub;
        }
        next();
    }*/

    const initHeartbeat = async (req: express.Request, res: express.Response, next: Function) => {
        if(!init) {
            for(const c of clients) {
                await refreshClient(c);
            }
            init = true;
            loopHeartbeat();
        }
        next();
    };

    const redirectBotsNotAuthed = async (req: express.Request, res: express.Response, next: Function) => {
        if(cmInstances.length === 1 && cmInstances[0].error === 'Missing credentials: refreshToken, accessToken') {
            // assuming user is doing first-time setup and this is the default localhost bot
            return res.redirect('/auth/helper');
        }
        next();
    }

    const migrationRedirect = async (req: express.Request, res: express.Response, next: Function) => {
        const instance = req.instance as CMInstance;
        if(instance.bots.length === 0 && instance?.ranMigrations === false && instance?.migrationBlocker !== undefined) {
            return res.render('migrations', {
                type: 'app',
                ranMigrations: instance.ranMigrations,
                migrationBlocker: instance.migrationBlocker,
                instance: instance.friendly
            });
        }
        return next();
    };

    app.getAsync('/', [initHeartbeat, redirectBotsNotAuthed, ensureAuthenticated, defaultSession, defaultInstance, instanceWithPermissions, migrationRedirect, botWithPermissions(false, true), createUserToken], async (req: express.Request, res: express.Response) => {

        const user = req.user as Express.User;
        const instance = req.instance as CMInstance;

        const limit = req.session.limit;
        const sort = req.session.sort;
        const level = req.session.level;

        const shownInstances = cmInstances.reduce((acc: CMInstance[], curr) => {
            const isBotOperator = req.user?.isInstanceOperator(curr);
            if(user?.clientData?.webOperator) {
                // @ts-ignore
                return acc.concat({...curr.getData(), canAccessLocation: true, isOperator: isBotOperator});
            }
            if(!isBotOperator && !req.user?.canAccessInstance(curr)) {
                return acc;
            }
            // @ts-ignore
            return acc.concat({...curr.getData(), canAccessLocation: isBotOperator, isOperator: isBotOperator, botId: curr.getName()});
        },[]);

        let resp;
        try {
            resp = await got.get(`${instance.normalUrl}/status`, {
                headers: {
                    'Authorization': `Bearer ${req.token}`,
                },
                searchParams: {
                    bot: req.query.bot as (string | undefined),
                    subreddit: req.query.sub as (string | undefined) ?? 'all',
                    limit,
                    sort,
                    level,
                    //bot: req.query.bot as string,
                },
            }).json() as any;

        } catch(err: any) {
            instance.logger.error(new ErrorWithCause(`Could not retrieve instance information. Will attempted to update heartbeat.`, {cause: err}));
            refreshClient({host: instance.host, secret: instance.secret});
            const isOp = req.user?.isInstanceOperator(instance);
            return res.render('offline', {
                instances: shownInstances,
                instanceId: (req.instance as CMInstance).getName(),
                isOperator: isOp,
                // @ts-ignore
                logs: filterLogs((isOp ? instance.logs : instance.logs.filter(x => x.user === undefined || x.user.includes(req.user.name))), {limit, sort, level}),
                logSettings: {
                    limitSelect: [10, 20, 50, 100, 200].map(x => `<option ${limit === x ? 'selected' : ''} class="capitalize ${limit === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' | '),
                    sortSelect: ['ascending', 'descending'].map(x => `<option ${sort === x ? 'selected' : ''} class="capitalize ${sort === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' '),
                    levelSelect: availableLevels.map(x => `<option ${level === x ? 'selected' : ''} class="capitalize log-${x} ${level === x ? `font-bold` : ''}" data-value="${x}">${x}</option>`).join(' '),
                },
            })
            // resp = defaultBotStatus(intersect(user.subreddits, instance.subreddits));
            // resp.subreddits = resp.subreddits.map(x => {
            //     if(x.name === 'All') {
            //         x.logs = (botLogMap.get(instance.friendly) || []).map(x => formatLogLineToHtml(x[1]));
            //     }
            //     return x;
            // })
        }

        //const instanceOperator = instance.operators.includes((req.user as Express.User).name);

        // const shownBots = instance.bots.reduce((acc: BotInstance[], curr) => {
        //     if(!instanceOperator && intersect(user.subreddits, curr.subreddits).length === 0) {
        //         return acc;
        //     }
        //     // @ts-ignore
        //     return acc.concat({...curr, isOperator: instanceOperator});
        // },[]);

        const isOp = req.user?.isInstanceOperator(instance);

        // const bots = resp.bots.map((x: BotStatusResponse) => {
        //     return {
        //         ...x,
        //         subreddits: x.subreddits.map(y => {
        //            return {
        //                ...y,
        //                guests: y.guests.map(z => {
        //                    const d = z.expiresAt === undefined ? undefined : dayjs(z.expiresAt);
        //                    return {
        //                        ...z,
        //                        relative: d === undefined ? 'Never' : dayjs.duration(d.diff(dayjs())).humanize(),
        //                        date: d === undefined ? 'Never' : d.format('YYYY-MM-DD HH:mm:ssZ')
        //                    }
        //                })
        //            }
        //         })
        //     }
        // });

        res.render('status', {
            instances: shownInstances,
            bots: resp.bots,
            now: dayjs().add(1, 'minute').format('YYYY-MM-DDTHH:mm'),
            botId: (req.instance as CMInstance).getName(),
            instanceId: (req.instance as CMInstance).getName(),
            isOperator: isOp,
            system: isOp ? {
                // @ts-ignore
                logs: resp.system.logs.map((x: LogInfo) => formatLogLineToHtml(formatter.transform(x)[MESSAGE] as string, x.timestamp)),
                } : undefined,
            operators: instance.operators.join(', '),
            operatorDisplay: instance.operatorDisplay,
            logSettings: {
                limitSelect: [10, 20, 50, 100, 200].map(x => `<option ${limit === x ? 'selected' : ''} class="capitalize ${limit === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' | '),
                sortSelect: ['ascending', 'descending'].map(x => `<option ${sort === x ? 'selected' : ''} class="capitalize ${sort === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' '),
                levelSelect: availableLevels.map(x => `<option ${level === x ? 'selected' : ''} class="capitalize log-${x} ${level === x ? `font-bold` : ''}" data-value="${x}">${x}</option>`).join(' '),
            },
        });
    });

    app.getAsync('/bot/invites', defaultSession, async (req: express.Request, res: express.Response) => {
        res.render('modInvites', {
            title: `Pending Moderation Invites`,
        });
    });

    app.getAsync('/config', defaultSession, async (req: express.Request, res: express.Response) => {
        const {format = 'json'} = req.query as any;
        res.render('config', {
            title: `Configuration Editor`,
            format,
            canSave: req.user?.clientData?.scope?.includes('wikiedit') && req.user?.clientData?.tokenExpiresAt !== undefined && dayjs.unix(req.user?.clientData.tokenExpiresAt).isAfter(dayjs())
        });
    });

    app.getAsync('/guest', [ensureAuthenticatedApi, defaultSession, instanceWithPermissions, botWithPermissions(true)], async (req: express.Request, res: express.Response) => {
        const {subreddit} = req.query as any;
        return res.status(req.user?.isSubredditGuest(req.bot, subreddit) ? 200 : 403).send();
    });

    app.postAsync('/config', [ensureAuthenticatedApi, defaultSession, instanceWithPermissions, botWithPermissions(true)], async (req: express.Request, res: express.Response) => {
        const {subreddit} = req.query as any;
        const {location, data, reason = 'Updated through CM Web', create = false} = req.body as any;

        const client = new ExtendedSnoowrap({
            userAgent,
            clientId,
            clientSecret,
            accessToken: req.user?.clientData?.token
        });

        try {
            // @ts-ignore
            const wiki = await client.getSubreddit(subreddit).getWikiPage(location);
            await wiki.edit({
                text: data,
                reason
            });
        } catch (err: any) {
            res.status(500);
            return res.send(err.message);
        }

        if(create) {
            try {
                // @ts-ignore
                await client.getSubreddit(subreddit).getWikiPage(location).editSettings({
                    permissionLevel: 2,
                    // don't list this page on r/[subreddit]/wiki/pages
                    listed: false,
                });
            } catch (err: any) {
                res.status(500);
                return res.send(`Successfully created wiki page for configuration but encountered error while setting visibility. You should manually set the wiki page visibility on reddit. \r\n Error: ${err.message}`);
            }
        }

        res.status(200);
        return res.send();
    });

    app.getAsync('/events', [ensureAuthenticatedApi, defaultSession, instanceWithPermissions, botWithPermissions(true), createUserToken], async (req: express.Request, res: express.Response) => {
        const {subreddit, page = 1, permalink, related, author} = req.query as any;
        const resp = await got.get(`${(req.instance as CMInstanceInterface).normalUrl}/events`, {
            headers: {
                'Authorization': `Bearer ${req.token}`,
            },
            searchParams: {
                subreddit,
                bot: req.bot?.botName,
                page,
                permalink,
                related,
                author
            }
        }).json() as PaginationAwareObject;

        const {data: eventData, ...pagination} = resp;

        // for now just want to get this back in the same shape the ui expects so i don't have to refactor the entire events page
        // @ts-ignore
        const actionedEventsData: ActionedEvent[] = eventData.map((x: CMEvent) => {
           const ea: EventActivity = {
               peek: Autolinker.link(peekTrunc(x.activity.content), {
                   email: false,
                   phone: false,
                   mention: false,
                   hashtag: false,
                   stripPrefix: false,
                   sanitizeHtml: true,
                   urls: false
               }),
               link: `https://reddit.com${x.activity.permalink}`,
               type: x.activity.type,
               subreddit: x.activity.subreddit.name,
               id: x.activity.name,
               author: x.activity.author.name
           };
           let submission: EventActivity | undefined;
           if(x.activity.submission !== undefined && x.activity.submission !== null) {
               submission = {
                   peek: Autolinker.link(peekTrunc(x.activity.submission.content), {
                       email: false,
                       phone: false,
                       mention: false,
                       hashtag: false,
                       stripPrefix: false,
                       sanitizeHtml: true,
                       urls: false
                   }),
                   link: `https://reddit.com${x.activity.submission.permalink}`,
                   type: 'submission',
                   subreddit: x.activity.subreddit.name,
                   id: x.activity.submission.name,
                   author: x.activity.submission.author.name
               };
           }
           return {
               activity: ea,
               submission,
               subreddit: x.activity.subreddit.name,
               timestamp: dayjs(x.processedAt).local().format('YY-MM-DD HH:mm:ss z'),
               triggered: x.triggered,
               dispatchSource: {
                   ...x.source,
                   queuedAt: dayjs(x.queuedAt).local().format('YY-MM-DD HH:mm:ss z')
               },
               runResults: x.runResults.map(y => {
                   return {
                       name: y.run.name,
                       triggered: y.triggered,
                       reason: y.reason,
                       error: y.error,
                       itemIs: y._itemIs,
                       authorIs: y._authorIs,
                       checkResults: y.checkResults.map(z => {

                           return {
                               ...z,
                               itemIs: z.itemIs,
                               authorIs: z.authorIs,
                               // @ts-ignore
                               ruleResults: z.ruleResults?.map((a: RuleResultEntity | RuleSetResultEntity) => {
                                   if('condition' in a) {
                                       return {
                                           ...a,
                                           results: (a as RuleSetResultEntity).results.map(b => ({
                                               ...b,
                                               itemIs: b.itemIs,
                                               authorIs: b.authorIs,
                                               name: RulePremise.getFriendlyIdentifier(b.premise)
                                           }))
                                       }
                                   }
                                   const b = a as RuleResultEntity;
                                   return {
                                       ...b,
                                       itemIs: b.itemIs,
                                       authorIs: b.authorIs,
                                       name: RulePremise.getFriendlyIdentifier(b.premise)
                                   }
                               }),
                               actionResults: z.actionResults?.map(a => {
                                   return {
                                       ...a,
                                       itemIs: a.itemIs,
                                       authorIs: a.authorIs,
                                       name: ActionPremise.getFriendlyIdentifier(a.premise)
                                   }
                               })
                           }
                       })
                   }
               })
           }
        });

        const actionedEvents = actionedEventsData.map((x: ActionedEvent) => {
            const {timestamp, activity: {peek, link, ...restAct}, runResults = [], dispatchSource, ...rest} = x;
            //const time = dayjs(timestamp).local().format('YY-MM-DD HH:mm:ss z');
            const formattedPeek = Autolinker.link(peek.replace(`https://reddit.com${link}`, ''), {
                email: false,
                phone: false,
                mention: false,
                hashtag: false,
                stripPrefix: false,
                sanitizeHtml: true,
                urls: false
            });
            const formattedRunResults = runResults.map((summ: RunResult) => {
                const {checkResults = [], ...rest} = summ;
                const formattedCheckResults = checkResults.map((y: CheckSummary) => {
                    const {actionResults = [], ruleResults = [], triggered: checkTriggered, authorIs, itemIs, ...rest} = y;

                    // @ts-ignore
                    const formattedRuleResults = ruleResults.map((z: RuleResult) => {
                        if('condition' in z) {
                            const y = z as unknown as RuleSetResultEntity;
                            return {
                                condition: y.condition,
                                triggered: triggeredIndicator(y.triggered),
                                results: y.results.map(a => {
                                    const {triggered, result, ...restA} = a;
                                    return {
                                        ...restA,
                                        triggered: triggeredIndicator(triggered ?? null, 'Skipped'),
                                        result: result || '-',
                                        // @ts-ignore
                                        ...formatFilterData(a)
                                }})
                            }
                        }
                        const {triggered, result, ...restY} = z;
                        return {
                            ...restY,
                            triggered: triggeredIndicator(triggered, 'Skipped'),
                            result: result || '-',
                            ...formatFilterData(z)
                        };
                    });
                    const formattedActionResults = actionResults.map((z: ActionResult) => {
                        const {run, runReason, success, result, dryRun, ...restA} = z;
                        let res = '';
                        if(!run) {
                            res = `Not Run - ${runReason === undefined ? '(No Reason)' : runReason}`;
                        } else {
                            res = `${triggeredIndicator(success)}${result !== undefined ? ` - ${result}` : ''}`;
                        }
                        return {
                            ...restA,
                            dryRun: dryRun ? ' (DRYRUN)' : '',
                            result: res,
                            ...formatFilterData(z)
                        };
                    });
                    let ruleSummary = '(No rules to run)';
                    const filterData = formatFilterData(y);
                    if(y.fromCache) {
                        ruleSummary =  `Check result was found in cache: ${triggeredIndicator(checkTriggered, 'Skipped')}`;
                    } else {
                        const filterSummary = Object.entries(filterData).reduce((acc, [k,v]) => {
                            if(v !== undefined && (v as any).passed === '✘') {
                                return `Did not pass ${k} filter`;
                            }
                            return acc;
                        }, '')
                        if(filterSummary !== '') {
                            ruleSummary = filterSummary;
                        } else if(ruleResults.length > 0) {
                            ruleSummary = resultsSummary(ruleResults, y.condition);
                        }
                    }
                    return {
                        ...rest,
                        triggered: triggeredIndicator(checkTriggered, 'Skipped'),
                        triggeredVal: checkTriggered,
                        ruleResults: formattedRuleResults,
                        actionResults: formattedActionResults,
                        ruleSummary,
                        ...filterData
                    }
                });

                return {
                    ...rest,
                    triggered: triggeredIndicator(summ.triggered, 'Skipped'),
                    triggeredVal: summ.triggered,
                    checkResults: formattedCheckResults,
                    ...formatFilterData(summ)
                }
            });
            return {
                dispatchSource,
                ...rest,
                timestamp,
                activity: {
                    link,
                    peek: formattedPeek,
                    ...restAct,
                },
                triggered: triggeredIndicator(x.triggered),
                triggeredVal: x.triggered,
                runResults: formattedRunResults,
            }
        });

        return res.render('events', {
            data: actionedEvents,
            pagination,
            subreddit,
            bot: req.bot?.botName,
            instance: (req.instance as CMInstance).getName(),
            title: `${subreddit !== undefined ? `${subreddit} ` : ''}Actioned Events`
        });
    });

    app.postAsync('/database/migrate', [], async (req: express.Request, res: express.Response) => {
        const now = dayjs().subtract(1, 'second');
        logger.info(`User invoked migrations. Starting migrations now...`);

        try {
            await migrationService.doMigration();
            ranMigrations = true;
            migrationBlocker = undefined;
        } finally {
            if(ranMigrations && !sessionSecretSynced) {
                // ensure session secret is synced
                await storage.setSessionSecret(sessionSecret)
            }
            const dbLogs = webLogs.filter(x => x.labels?.includes('Database') && dayjs(x.timestamp).isSameOrAfter(now));
            dbLogs.reverse();
            res.status(ranMigrations ? 200 : 500).send(dbLogs.map(x => x[MESSAGE]).join('\r\n'));
        }
    });

    app.getAsync('/database/logs', [], async (req: express.Request, res: express.Response) => {
        const dbLogs = webLogs.filter(x => {
            return x.labels?.includes('Database');
        });

        dbLogs.reverse();
        res.send(dbLogs.map(x => x[MESSAGE]).join('\r\n'));
    });

    app.postAsync('/database/backup', [], async (req: express.Request, res: express.Response) => {
        logger.info(`User invoked database backup. Trying to backup now...`);

        const now = dayjs().subtract(1, 'second');
        let status = 200;
        try {
            await migrationService.backupDatabase();
        } catch (e) {
            status = 500;
        }

        const dbLogs = webLogs.filter(x => {
            const logTime = dayjs(x.timestamp);
            // @ts-ignore
            return x.leaf === 'Backup' && logTime.isSameOrAfter(now)
        });

        dbLogs.reverse();
        res.status(status).send(dbLogs.map(x => x[MESSAGE]).join('\r\n'));
    });

    app.getAsync('/logs/settings/update',[ensureAuthenticated], async (req: express.Request, res: express.Response) => {
        const e = req.query;
        for (const [setting, val] of Object.entries(req.query)) {
            switch (setting) {
                case 'limit':
                    req.session.limit = Number.parseInt(val as string);
                    break;
                case 'sort':
                    req.session.sort = val as string;
                    break;
                case 'level':
                    req.session.level = val as string;
                    break;
            }
        }

        res.send('OK');
    });

    const sockStreams: Map<string, (AbortController | NodeJS.Timeout)[]> = new Map();
    const socketListeners: Map<string, any[]> = new Map();

    const clearSockStreams = (socketId: string) => {
        const currStreams = sockStreams.get(socketId) || [];
        for(const s of currStreams) {
            if(s instanceof AbortController) {
                s.abort();
            } else {
                clearInterval(s)
            }
        }
    }
    const clearSockListeners = (socketId: string) => {
        const listeners = socketListeners.get(socketId) || [];
        for(const l of listeners) {
            emitter.removeListener('log', l);
        }
    }

    io.use(sharedSession(sessionObj));

    io.on("connection", function (socket) {
        // @ts-ignore
        const session = socket.handshake.session as (Session & Partial<SessionData> | undefined);
        // @ts-ignore
        const user = session !== undefined ? session?.passport?.user as Express.User : undefined;

        let liveInterval: any = undefined;

        if (session !== undefined && user !== undefined) {
            clearSockStreams(socket.id);
            socket.join(session.id);

            if(session.botId !== undefined) {
                const bot = cmInstances.find(x => x.getName() === session.botId);
                if(bot !== undefined) {
                    // web log listener for bot specifically
                    const botWebLogListener = (log: LogInfo) => {
                        const {subreddit, instance, user: userFromLog} = log;
                        if((subreddit !== undefined || instance !== undefined)
                            && isLogLineMinLevel(log, session.level as string)
                            && (session.botId?.toLowerCase() === instance
                                || user.clientData?.webOperator === true
                                || (userFromLog !== undefined && userFromLog.toLowerCase().includes(user.name.toLowerCase()))
                            )) {
                            // @ts-ignore
                            const formattedMessage = formatLogLineToHtml(formatter.transform(log)[MESSAGE], log.timestamp);
                            io.to(session.id).emit('log', {...log, formattedMessage});
                        }
                    }
                    emitter.on('log', botWebLogListener);
                    socketListeners.set(socket.id, [...(socketListeners.get(socket.id) || []), botWebLogListener]);

                    // only setup streams if the user can actually access them (not just a web operator)
                    if(session.authBotId !== undefined) {
                        // streaming stats from client
                        const newStreams: (AbortController | NodeJS.Timeout)[] = [];
                        const interval = setInterval(async () => {
                            try {
                                const resp = await got.get(`${bot.normalUrl}/stats`, {
                                    headers: {
                                        'Authorization': `Bearer ${createToken(bot, user)}`,
                                    }
                                }).json() as object;
                                io.to(session.id).emit('opStats', resp);
                            } catch (err: any) {
                                bot.logger.error(new ErrorWithCause('Could not retrieve stats', {cause: err}));
                                clearInterval(interval);
                            }
                        }, 5000);
                        newStreams.push(interval);
                        sockStreams.set(socket.id, newStreams);
                    }
                }
            }
        }
        socket.on('disconnect', (reason) => {
            clearSockStreams(socket.id);
            clearSockListeners(socket.id);
            clearInterval(liveInterval);
        });
    });

    const loopHeartbeat = async () => {
        while(true) {
            for(const c of clients) {
                await refreshClient(c);
            }
            // sleep for 10 seconds then do heartbeat check again
            await sleep(10000);
        }
    }

    const addBot = async (bot: CMInstanceInterface, userPayload: any, botPayload: any) => {
        try {
            const token = createToken(bot, userPayload);
            const resp = await got.post(`${bot.normalUrl}/bot`, {
                body: JSON.stringify(botPayload),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                }
            }).json() as object;
            return {success: true, ...resp};
        } catch (err: any) {
            return {success: false, error: err.message};
        }
    }

    const refreshClient = async (client: BotConnection, force = false) => {
        const existingClientIndex = cmInstances.findIndex(x => x.matchesHost(client.host));
        const instance = existingClientIndex === -1 ? new CMInstance(client, logger) : cmInstances[existingClientIndex];

        await instance.checkHeartbeat(force);

        if(existingClientIndex === -1) {
            cmInstances.push(instance);
        }
    }
}

export default webClient;
