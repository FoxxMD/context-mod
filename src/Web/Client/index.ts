import {addAsync, Router} from "@awaitjs/express";
import express, {Request, Response} from "express";
import bodyParser from "body-parser";
import cookieParser from 'cookie-parser';
// @ts-ignore
import CacheManagerStore from 'express-session-cache-manager'
import passport from 'passport';
import {Strategy as CustomStrategy} from 'passport-custom';
import {OperatorConfig, BotConnection} from "../../Common/interfaces";
import {
    createCacheManager, filterLogBySubreddit,
    formatLogLineToHtml,
    intersect, isLogLineMinLevel,
    LogEntry, parseFromJsonOrYamlToObject,
    parseSubredditLogName, permissions,
    randomId, sleep
} from "../../util";
import {Cache} from "cache-manager";
import session, {Session, SessionData} from "express-session";
import Snoowrap, {Subreddit} from "snoowrap";
import {getLogger} from "../../Utils/loggerFactory";
import EventEmitter from "events";
import stream, {Readable, Writable, Transform} from "stream";
import winston from "winston";
import tcpUsed from "tcp-port-used";
import SimpleError from "../../Utils/SimpleError";
import http from "http";
import jwt from 'jsonwebtoken';
import {Server as SocketServer} from "socket.io";
import got from 'got';
import sharedSession from "express-socket.io-session";
import dayjs from "dayjs";
import httpProxy from 'http-proxy';
import normalizeUrl from 'normalize-url';
import GotRequest from "got/dist/source/core";
import {prettyPrintJson} from "pretty-print-json";
// @ts-ignore
import DelimiterStream from 'delimiter-stream';
import {pipeline} from 'stream/promises';
import {defaultBotStatus} from "../Common/defaults";
import {booleanMiddle} from "../Common/middleware";
import {BotInstance, CMInstance} from "../interfaces";
import { URL } from "url";

const emitter = new EventEmitter();

const app = addAsync(express());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
//app.use(cookieParser());
app.set('views', `${__dirname}/../assets/views`);
app.set('view engine', 'ejs');
app.use('/public', express.static(`${__dirname}/../assets/public`));

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
        botId?: string,
        authBotId?: string,
    }
}

// declare global {
//     namespace Express {
//         interface User {
//             name: string
//             subreddits: string[]
//             machine?: boolean
//             isOperator?: boolean
//             realManagers?: string[]
//             moderatedManagers?: string[]
//         }
//     }
// }

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

const createToken = (bot: CMInstance, user?: Express.User, ) => {
    const payload = user !== undefined ? {...user, machine: false} : {machine: true};
    return jwt.sign({
        data: payload,
    }, bot.secret, {
        expiresIn: '1m'
    });
}

const availableLevels = ['error', 'warn', 'info', 'verbose', 'debug'];

const botLogMap: Map<string, LogEntry[]> = new Map();

const webClient = async (options: OperatorConfig) => {
    const {
        operator: {
            name,
            display,
        },
        web: {
            port,
            session: {
                provider,
                secret,
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
    } = options;

    const connectedUsers: ConnectUserObj = {};

    const webOps = operators.map(x => x.toLowerCase());

    const winstonStream = new Transform({
        transform(chunk, encoding, callback) {
            const logLine = chunk.toString().slice(0, -1);
            const now = Date.now();
            const logEntry: LogEntry = [now, logLine];
            const subName = parseSubredditLogName(logLine);
            if (subName !== undefined) {
                const subLogs = botLogMap.get(subName) || [];
                subLogs.unshift(logEntry);
                botLogMap.set(subName, subLogs.slice(0, 200 + 1));
            } else {
                const appLogs = botLogMap.get('web') || [];
                appLogs.unshift(logEntry);
                botLogMap.set('web', appLogs.slice(0, 200 + 1));
            }
            emitter.emit('log', logLine);
            callback(null,chunk);
        }
    });

    const logger = getLogger({defaultLabel: 'Web', ...options.logging}, 'Web');

    logger.add(new winston.transports.Stream({
        stream: winstonStream,
    }))

    if (await tcpUsed.check(port)) {
        throw new SimpleError(`Specified port for web interface (${port}) is in use or not available. Cannot start web server.`);
    }

    if (provider.store === 'none') {
        logger.warn(`Cannot use 'none' for session store or else no one can use the interface...falling back to 'memory'`);
        provider.store = 'memory';
    }
    //const webCache = createCacheManager(provider) as Cache;

    //<editor-fold desc=Session and Auth>
    /*
    * Session and Auth
    * */

    passport.serializeUser(async function (data: any, done) {
        const {user, subreddits} = data;
        //await webCache.set(`userSession-${user}`, { subreddits: subreddits.map((x: Subreddit) => x.display_name), isOperator: webOps.includes(user.toLowerCase()) }, {ttl: provider.ttl as number});
        done(null, { subreddits: subreddits.map((x: Subreddit) => x.display_name), isOperator: webOps.includes(user.toLowerCase()), name: user });
    });

    passport.deserializeUser(async function (obj, done) {
        done(null, obj as Express.User);
        // const data = await webCache.get(`userSession-${obj}`) as object;
        // if (data === undefined) {
        //     done('Not Found');
        // }
        //
        // done(null, {...data, name: obj as string} as Express.User);
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
            const client = await Snoowrap.fromAuthCode({
                userAgent: `web:contextBot:web`,
                clientId,
                clientSecret,
                redirectUri: redirectUri as string,
                code: code as string,
            });
            const user = await client.getMe().name as string;
            const subs = await client.getModeratedSubreddits();
            return done(null, {user, subreddits: subs});
        }
    ));

    const sessionObj = session({
        cookie: {
            maxAge: provider.ttl,
        },
        store: new CacheManagerStore(createCacheManager(provider) as Cache),
        resave: false,
        saveUninitialized: false,
        secret,
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

    app.getAsync('/login', async (req, res, next) => {
        if (redirectUri === undefined) {
            return res.render('error', {error: `No <b>redirectUri</b> was specified through environmental variables or program argument. This must be provided in order to use the web interface.`});
        }
        req.session.state = randomId();
        const authUrl = Snoowrap.getAuthUrl({
            clientId,
            scope: ['identity', 'mysubreddits'],
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
                return res.render('error', {error: errContent, });
            }
            const client = await Snoowrap.fromAuthCode({
                userAgent: `web:contextBot:web`,
                // @ts-ignore
                clientId: req.session.clientId,
                // @ts-ignore
                clientSecret: req.session.clientSecret,
                // @ts-ignore
                redirectUri: req.session.redir,
                code: code as string,
            });
            // @ts-ignore
            const user = await client.getMe();
            let hadToken = false;
            // @ts-ignore
            if(req.session.token !== undefined) {
                // user made successful callback using bypass token

                // @ts-ignore
                delete req.session.token;
                // reset token (one-use)
                token = randomId();

                hadToken = true;
            }
            return res.render('callback', {
                accessToken: client.accessToken,
                refreshToken: client.refreshToken,
                hadToken,
            });
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
                return res.redirect('/');
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
        // allow helper access if no operator is listed
        if(operators.length === 0) {
            return next();
        }
        // or if there is an operator and current user is operator
        if(req.isAuthenticated() && req.user.isOperator) {
            return next();
        }
        // or if the bypass token was provided (can only be acquired from an authenticated operator)
        if(req.query.token === token) {
            return next();
        }
        let error = 'You are not authorized to access this route.';
        if(operators.length > 0) {
            error = `${error} <br/> If you are doing first-time setup with just client id and secret you need to remove the "operator" property in order to access the oauth helper route.`;
        }
        return res.render('error', {error});
    }

    app.getAsync('/auth/helper', helperAuthed, (req, res) => {
        return res.render('helper', {
            redirectUri,
            clientId,
            clientSecret,
            token: req.isAuthenticated() && req.user.isOperator ? token : undefined
        });
    });

    app.getAsync('/auth/init', [helperAuthed, booleanMiddle(['wikiEdit','modmail','modlog'])], async (req: express.Request, res: express.Response) => {
        const {
            token,
            wikiEdit,
            modlog,
            modmail,
            clientId: ci,
            clientSecret: ce,
            redirect: redir,
        } = req.query as any;
        let permissionsList = permissions;

        // keep track of token use so we can remove it after successful callback
        if(token !== undefined) {
            // @ts-ignore
            req.session.token = token;
        }
        if (!wikiEdit) {
            permissionsList = permissionsList.filter(x => x !== 'wikiedit');
        }
        if (!modlog) {
            permissionsList = permissionsList.filter(x => x !== 'modlog');
        }
        if (!modmail) {
            permissionsList = permissionsList.filter(x => x !== 'modmail');
        }
        req.session.state = `bot_${randomId()}`;
        // @ts-ignore
        req.session.redir = redir;
        const cid = ci || clientId;
        if(cid === undefined || cid === '') {
            return res.render('error', {error: '"clientId" is required'});
        }
        // @ts-ignore
        req.session.clientId = cid.trim();

        const ced = ce || clientSecret;
        if(ced === undefined || ced === '') {
            return res.render('error', {error: '"clientSecret" is required'});
        }
        // @ts-ignore
        req.session.clientSecret = ced.trim();

        if(redir === undefined || redir === '') {
            return res.render('error', {error: '"redirectUri" is required'});
        }

        const authUrl = Snoowrap.getAuthUrl({
            // @ts-ignore
            clientId: req.session.clientId as string,
            // @ts-ignore
            clientSecret: req.session.clientSecret as string,
            scope: permissionsList,
            // @ts-ignore
            redirectUri: redir.trim(),
            permanent: true,
            state: req.session.state
        });
        return res.redirect(authUrl);
    });
    //</editor-fold>

    const cmInstances: CMInstance[] = [];
    let init = false;

    let server: http.Server,
        io: SocketServer;

    const startLogStream = (sessionData: Session & Partial<SessionData>, user: Express.User) => {
        // @ts-ignore
        const sessionId = sessionData.id as string;
        
        if(connectedUsers[sessionId] !== undefined) {

            const delim = new DelimiterStream({
                delimiter: '\r\n',
            });

            const currInstance = cmInstances.find(x => x.friendly === sessionData.botId);
            if(currInstance !== undefined) {
                const ac = new AbortController();
                const options = {
                    signal: ac.signal,
                };

                const retryFn = (retryCount = 0, err: any = undefined) => {
                    const delim = new DelimiterStream({
                        delimiter: '\r\n',
                    });

                    if(err !== undefined) {
                        logger.warn(`Log streaming encountered an error, trying to reconnect (retries: ${retryCount}) -- ${err.code !== undefined ? `(${err.code}) ` : ''}${err.message}`, {subreddit: currInstance.friendly});
                    }
                    const gotStream = got.stream.get(`${currInstance.normalUrl}/logs`, {
                        retry: {
                            limit: 5,
                        },
                        headers: {
                            'Authorization': `Bearer ${createToken(currInstance, user)}`,
                        },
                        searchParams: {
                            limit: sessionData.limit,
                            sort: sessionData.sort,
                            level: sessionData.level,
                            stream: true
                        }
                    });

                    if(err !== undefined) {
                        gotStream.once('data', () => {
                            logger.info('Streaming resumed', {subreddit: currInstance.friendly});
                        });
                    }

                    gotStream.retryCount = retryCount;
                    const s = pipeline(
                        gotStream,
                        delim,
                        options
                    ) as Promise<void>;

                    // ECONNRESET
                    s.catch((err) => {
                        if(err.code !== 'ABORT_ERR' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                            logger.error(`Unexpected error, or too many retries, occurred while streaming logs -- ${err.code !== undefined ? `(${err.code}) ` : ''}${err.message}`, {subreddit: currInstance.friendly});
                        }
                    });

                    delim.on('data', (c: any) => {
                        const chunk = c.toString();
                        io.to(sessionId).emit('log', formatLogLineToHtml(chunk));
                    });

                    gotStream.once('retry', retryFn);
                }

                retryFn();

                return ac;
            }
            return undefined;
        }
    }

    try {
        server = await app.listen(port);
        io = new SocketServer(server);
    } catch (err) {
        logger.error('Error occurred while initializing web or socket.io server', err);
        err.logged = true;
        throw err;
    }
    logger.info(`Web UI started: http://localhost:${port}`, {label: ['Web']});

    const instanceWithPermissions = async (req: express.Request, res: express.Response, next: Function) => {
        delete req.session.botId;
        delete req.session.authBotId;

        const msg = 'Bot does not exist or you do not have permission to access it';
        const instance = cmInstances.find(x => x.friendly === req.query.instance);
        if (instance === undefined) {
            return res.status(404).render('error', {error: msg});
        }

        const user = req.user as Express.User;

        const isOperator = instance.operators.includes(user.name);
        const canAccessBot = isOperator || intersect(user.subreddits, instance.subreddits).length === 0;
        if (user.isOperator && !canAccessBot) {
            return res.status(404).render('error', {error: msg});
        }

        if (req.params.subreddit !== undefined && !isOperator && !user.subreddits.includes(req.params.subreddit)) {
            return res.status(404).render('error', {error: msg});
        }
        req.instance = instance;
        req.session.botId = instance.friendly;
        if(canAccessBot) {
            req.session.authBotId = instance.friendly;
        }
        return next();
    }


    const botWithPermissions = async (req: express.Request, res: express.Response, next: Function) => {

        const instance = req.instance;
        if(instance === undefined) {
            return res.status(401).send("Instance must be defined");
        }

        const msg = 'Bot does not exist or you do not have permission to access it';
        const botVal = req.query.bot as string;
        if(botVal === undefined) {
            return res.status(400).render('error', {error: `"bot" param must be defined`});
        }

        const botInstance = instance.bots.find(x => x.botName === botVal);
        if(botInstance === undefined) {
            return res.status(404).render('error', {error: msg});
        }

        const user = req.user as Express.User;

        const isOperator = instance.operators.includes(user.name);
        const canAccessBot = isOperator || intersect(user.subreddits, botInstance.subreddits).length === 0;
        if (user.isOperator && !canAccessBot) {
            return res.status(404).render('error', {error: msg});
        }

        if (req.params.subreddit !== undefined && !isOperator && !user.subreddits.includes(req.params.subreddit)) {
            return res.status(404).render('error', {error: msg});
        }
        req.bot = botInstance;
        next();
    }

    const createUserToken = async (req: express.Request, res: express.Response, next: Function) => {
        req.token = createToken(req.instance as CMInstance, req.user);
        next();
    }

    const defaultSession = (req: express.Request, res: express.Response, next: Function) => {
        if(req.session.limit === undefined) {
            req.session.limit = 200;
            req.session.level = 'verbose';
            req.session.sort = 'descending';
            req.session.save();
            // @ts-ignore
            connectedUsers[req.session.id] = {};
        }
        next();
    }

    // const authenticatedRouter = Router();
    // authenticatedRouter.use([ensureAuthenticated, defaultSession]);
    // app.use(authenticatedRouter);
    //
    // const botUserRouter = Router();
    // botUserRouter.use([ensureAuthenticated, defaultSession, botWithPermissions, createUserToken]);
    // app.use(botUserRouter);

    app.useAsync('/api/', [ensureAuthenticated, defaultSession, instanceWithPermissions, botWithPermissions, createUserToken], (req: express.Request, res: express.Response) => {
        req.headers.Authorization = `Bearer ${req.token}`

        const instance = req.instance as CMInstance;
        return proxy.web(req, res, {
            target: {
                protocol: instance.url.protocol,
                host: instance.url.hostname,
                port: instance.url.port,
            },
            prependPath: false,
        });
    });

    const defaultInstance = async (req: express.Request, res: express.Response, next: Function) => {
        if(req.query.instance === undefined) {
            if(cmInstances.length > 0) {
                return res.redirect(`/?instance=${cmInstances[0].friendly}`);
            } else {
                // TODO better noSubs page
                return res.render('noSubs');
            }
        }
        const instance = cmInstances.find(x => x.friendly === req.query.instance);
        req.instance = instance;
        next();
    }
    const defaultBot = async (req: express.Request, res: express.Response, next: Function) => {
        if(req.query.bot === undefined) {
            const instance = req.instance as CMInstance;
            if(instance.bots.length > 0) {
                return res.redirect(`/?instance=${req.query.instance}&bot=${instance.bots[0].botName}`);
            } else {
                // TODO better noSubs page
                return res.render('noSubs');
            }
        }
        next();
    }

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

    app.getAsync('/', [initHeartbeat, redirectBotsNotAuthed, ensureAuthenticated, defaultSession, defaultInstance, defaultBot, instanceWithPermissions, botWithPermissions, createUserToken], async (req: express.Request, res: express.Response) => {

        const user = req.user as Express.User;
        const instance = req.instance as CMInstance;

        const limit = req.session.limit;
        const sort = req.session.sort;
        const level = req.session.level;
        let resp;
        try {
            resp = await got.get(`${instance.normalUrl}/status`, {
                headers: {
                    'Authorization': `Bearer ${req.token}`,
                },
                searchParams: {
                    limit,
                    sort,
                    level,
                    bot: req.query.bot as string,
                },
            }).json() as any;

        } catch(err) {
            logger.error(`Error occurred while retrieving bot information. Will update heartbeat -- ${err.message}`);
            refreshClient(clients.find(x => normalizeUrl(x.host) === instance.normalUrl) as BotConnection);
            resp = defaultBotStatus(intersect(user.subreddits, instance.subreddits));
            resp.subreddits = resp.subreddits.map(x => {
                if(x.name === 'All') {
                    x.logs = (botLogMap.get(instance.friendly) || []).map(x => formatLogLineToHtml(x[1]));
                }
                return x;
            })
        }

        const shownInstances = cmInstances.reduce((acc: CMInstance[], curr) => {
            const isBotOperator = curr.operators.map(x => x.toLowerCase()).includes(user.name.toLowerCase());
            if(user.isOperator) {
                // @ts-ignore
                return acc.concat({...curr, canAccessLocation: true, isOperator: isBotOperator});
            }
            if(!isBotOperator && intersect(user.subreddits, curr.subreddits).length === 0) {
                return acc;
            }
            // @ts-ignore
            return acc.concat({...curr, canAccessLocation: isBotOperator, isOperator: isBotOperator, botId: curr.friendly});
        },[]);

        const instanceOperator = instance.operators.includes((req.user as Express.User).name);

        const shownBots = instance.bots.reduce((acc: BotInstance[], curr) => {
            if(!instanceOperator && intersect(user.subreddits, curr.subreddits).length === 0) {
                return acc;
            }
            // @ts-ignore
            return acc.concat({...curr, isOperator: instanceOperator});
        },[]);

        res.render('status', {
            instances: shownInstances.map(x => ({...x, shown: x.friendly === instance.friendly})),
            bots: resp.map((x: any) => ({...x, shown: req.query.bot === x.name})),
            botId: (req.instance as CMInstance).friendly,
            instanceId: (req.instance as CMInstance).friendly,
            isOperator: instance.operators.includes((req.user as Express.User).name),
            operators: instance.operators.join(', '),
            operatorDisplay: instance.operatorDisplay,
            logSettings: {
                limitSelect: [10, 20, 50, 100, 200].map(x => `<option ${limit === x ? 'selected' : ''} class="capitalize ${limit === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' | '),
                sortSelect: ['ascending', 'descending'].map(x => `<option ${sort === x ? 'selected' : ''} class="capitalize ${sort === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' '),
                levelSelect: availableLevels.map(x => `<option ${level === x ? 'selected' : ''} class="capitalize log-${x} ${level === x ? `font-bold` : ''}" data-value="${x}">${x}</option>`).join(' '),
            },
        });
    });

    app.getAsync('/config', [ensureAuthenticated, defaultSession, instanceWithPermissions, botWithPermissions, createUserToken], async (req: express.Request, res: express.Response) => {
        const {subreddit} = req.query as any;
        const resp = await got.get(`${(req.instance as CMInstance).normalUrl}/config`, {
            headers: {
                'Authorization': `Bearer ${req.token}`,
            },
            searchParams: {
                subreddit,
                bot: req.bot?.botName
            }
        }).text();

        const [obj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(resp);
        const bot = req.instance as CMInstance;
        res.render('config', {
            config: prettyPrintJson.toHtml(obj, {quoteKeys: true, indent: 2}),
            operatorDisplay:bot.operators.join(', '),
            title: `Configuration for ${subreddit}`
        });
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
        if (session !== undefined && user !== undefined) {
            clearSockStreams(socket.id);
            socket.join(session.id);

            // setup general web log event
            const webLogListener = (log: string) => {
                const subName = parseSubredditLogName(log);
                if((subName === undefined || user.isOperator) && isLogLineMinLevel(log, session.level as string)) {
                    io.to(session.id).emit('webLog', formatLogLineToHtml(log));
                }
            }
            emitter.on('log', webLogListener);
            socketListeners.set(socket.id, [...(socketListeners.get(socket.id) || []), webLogListener]);

            if(session.botId !== undefined) {
                const bot = cmInstances.find(x => x.friendly === session.botId);
                if(bot !== undefined) {
                    // web log listener for bot specifically
                    const botWebLogListener = (log: string) => {
                        const subName = parseSubredditLogName(log);
                        if(subName !== undefined && isLogLineMinLevel(log, session.level as string) && (session.botId?.toLowerCase() === subName.toLowerCase() || subName.toLowerCase().includes(user.name.toLowerCase()))) {
                            io.to(session.id).emit('log', formatLogLineToHtml(log));
                        }
                    }
                    emitter.on('log', botWebLogListener);
                    socketListeners.set(socket.id, [...(socketListeners.get(socket.id) || []), botWebLogListener]);

                    // only setup streams if the user can actually access them (not just a web operator)
                    if(session.authBotId !== undefined) {
                        // streaming logs and stats from client
                        const newStreams: (AbortController | NodeJS.Timeout)[] = [];
                        const ac = startLogStream(session, user);
                        if(ac !== undefined) {
                            newStreams.push(ac);
                        }
                        const interval = setInterval(async () => {
                            try {
                                const resp = await got.get(`${bot.normalUrl}/stats`, {
                                    headers: {
                                        'Authorization': `Bearer ${createToken(bot, user)}`,
                                    }
                                }).json() as object;
                                io.to(session.id).emit('opStats', resp);
                            } catch (err) {
                                logger.error(`Could not retrieve stats ${err.message}`, {subreddit: bot.friendly});
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
        });
    });

    const loopHeartbeat = async () => {
        while(true) {
            logger.debug('Starting heartbeat check');
            for(const c of clients) {
                await refreshClient(c);
            }
            // sleep for 10 seconds then do heartbeat check again
            await sleep(10000);
        }
    }

    const refreshClient = async (client: BotConnection, force = false) => {
        const normalized = normalizeUrl(client.host);
        const existingClientIndex = cmInstances.findIndex(x => x.normalUrl === normalized);
        const existingClient = existingClientIndex === -1 ? undefined : cmInstances[existingClientIndex];

        let shouldCheck = false;
        if(!existingClient) {
            shouldCheck = true;
        } else if(force) {
            shouldCheck = true;
        } else  {
            const lastCheck = dayjs().diff(dayjs.unix(existingClient.lastCheck), 's');
            if(!existingClient.online) {
                if(lastCheck > 15) {
                    shouldCheck = true;
                }
            } else if(lastCheck > 300) {
                shouldCheck = true;
            }
        }
        if(shouldCheck)
        {
            const machineToken = jwt.sign({
                data: {
                    machine: true,
                },
            }, client.secret, {
                expiresIn: '1m'
            });
            //let base = `${c.host}${c.port !== undefined ? `:${c.port}` : ''}`;
            const normalized = normalizeUrl(client.host);
            const url = new URL(normalized);
            let botStat: CMInstance = {
                ...client,
                subreddits: [] as string[],
                operators: [] as string[],
                operatorDisplay: '',
                online: false,
                friendly: url.host,
                lastCheck: dayjs().unix(),
                normalUrl: normalized,
                url,
                bots: [],
            };
            try {
                const resp = await got.get(`${normalized}/heartbeat`, {
                    headers: {
                        'Authorization': `Bearer ${machineToken}`,
                    }
                }).json() as CMInstance;

                botStat = {...botStat, ...resp, online: true};
                const sameNameIndex = cmInstances.findIndex(x => x.friendly === botStat.friendly);
                if(sameNameIndex > -1 && sameNameIndex !== existingClientIndex) {
                    logger.warn(`Client returned a friendly name that is not unique (${botStat.friendly}), will fallback to host as friendly (${botStat.normalUrl})`);
                    botStat.friendly = botStat.normalUrl;
                }
                botStat.online = true;
                // if(botStat.online) {
                //     botStat.indicator = botStat.running ? 'green' : 'yellow';
                // } else {
                //     botStat.indicator = 'red';
                // }
                logger.verbose(`Heartbeat detected`, {subreddit: botStat.friendly});
            } catch (err) {
                botStat.error = err.message;
                logger.error(`Heartbeat response from ${botStat.friendly} was not ok: ${err.message}`, {subreddit: botStat.friendly});
            } finally {
                if(existingClientIndex !== -1) {
                    cmInstances.splice(existingClientIndex, 1, botStat);
                } else {
                    cmInstances.push(botStat);
                }
            }
        }
    }
}

export default webClient;
