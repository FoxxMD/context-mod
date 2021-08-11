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
    parseSubredditLogName,
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

declare global {
    namespace Express {
        interface User {
            name: string
            subreddits: string[]
            machine?: boolean
            isOperator?: boolean
            realManagers?: string[]
            moderatedManagers?: string[]
        }
    }
}

declare module 'express' {
    interface Request {
        token?: string,
        bot?: BotClient,
    }
}

interface BotClient extends BotConnection {
    friendly: string
    botName: string
    botLink: string
    online: boolean
    indicator: string
    lastCheck: number
    error?: string
    subreddits: string[]
    operators: string[]
    operatorDisplay: string
    nanny?: string
    running: boolean
    url: URL,
    normalUrl: string,
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

const createToken = (bot: BotClient, user?: Express.User, ) => {
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
            res.redirect('/login');
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

    app.getAsync(/.*callback$/, (req: express.Request, res: express.Response, next: Function) => {
        passport.authenticate('snoowrap', (err, user, info) => {
            if(err) {
                return res.render('error', {error: err});
            }
            req.logIn(user, (e) => {
                // don't know why we'd get an error here but ¯\_(ツ)_/¯
                if(e !== undefined) {
                    return res.render('err', {error: err});
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
    //</editor-fold>

    const bots: BotClient[] = [];
    let init = false;

    app.useAsync('/*', async (req, res, next) => {
        if(!init) {
            for(const c of clients) {
                await refreshClient(c);
            }
            init = true;
            loopHeartbeat();
        }
        next();
    });

    let server: http.Server,
        io: SocketServer;

    const startLogStream = (sessionData: Session & Partial<SessionData>, token: string) => {
        // @ts-ignore
        const sessionId = sessionData.id as string;
        
        if(connectedUsers[sessionId] !== undefined) {

            const delim = new DelimiterStream({
                delimiter: '\r\n',
            });

            const currBot = bots.find(x => x.friendly === sessionData.botId);
            if(currBot !== undefined) {
                const ac = new AbortController();
                const options = {
                    signal: ac.signal,
                };
                const s = pipeline(
                    got.stream.get(`${currBot.normalUrl}/logs`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                        },
                        searchParams: {
                            limit: sessionData.limit,
                            sort: sessionData.sort,
                            level: sessionData.level,
                            stream: true
                        }
                    }),
                    delim,
                    options
                ) as Promise<void>;

                s.catch((err) => {
                   if(err.code !== 'ABORT_ERR') {
                       logger.error(`Error occurred while streaming logs from ${currBot.friendly} -- ${err.message}`);
                   }
                });
                delim.on('data', (c: any) => {
                    const chunk = c.toString();
                    io.to(sessionId).emit('log', formatLogLineToHtml(chunk));
                });
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


    const botWithPermissions = async (req: express.Request, res: express.Response, next: Function) => {
        delete req.session.botId;
        delete req.session.authBotId;

        const msg = 'Bot does not exist or you do not have permission to access it';
        const bot = bots.find(x => x.friendly === req.query.bot);
        if (bot === undefined) {
            return res.render('error', {error: msg});
        }

        const user = req.user as Express.User;

        const isOperator = bot.operators.includes(user.name);
        const canAccessBot = isOperator || intersect(user.subreddits, bot.subreddits).length === 0;
        if (user.isOperator && !canAccessBot) {
            return res.render('error', {error: msg});
        }

        if (req.params.subreddit !== undefined && !isOperator && !user.subreddits.includes(req.params.subreddit)) {
            return res.render('error', {error: msg});
        }
        req.bot = bot;
        req.session.botId = bot.friendly;
        if(canAccessBot) {
            req.session.authBotId = bot.friendly;
        }
        next();
    }

    const createUserToken = async (req: express.Request, res: express.Response, next: Function) => {
        req.token = createToken(req.bot as BotClient, req.user);
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

    app.useAsync('/api/', [ensureAuthenticated, defaultSession, botWithPermissions, createUserToken], (req: express.Request, res: express.Response) => {
        req.headers.Authorization = `Bearer ${req.token}`

        const bot = req.bot as BotClient;
        return proxy.web(req, res, {
            target: {
                protocol: bot.url.protocol,
                host: bot.url.hostname,
                port: bot.url.port,
            },
            prependPath: false,
        });
    });

    const defaultBot = async (req: express.Request, res: express.Response, next: Function) => {
        if(req.query.bot === undefined) {
            if(bots.length > 0) {
                return res.redirect(`/?bot=${bots[0].friendly}`);
            } else {
                // TODO better noSubs page
                return res.render('noSubs');
            }
        }
        next();
    }

    app.getAsync('/', [ensureAuthenticated, defaultSession, defaultBot, botWithPermissions, createUserToken], async (req: express.Request, res: express.Response) => {

        const user = req.user as Express.User;
        const bot = req.bot as BotClient;

        const limit = req.session.limit;
        const sort = req.session.sort;
        const level = req.session.level;
        let resp;
        try {
            resp = await got.get(`${bot.normalUrl}/status`, {
                headers: {
                    'Authorization': `Bearer ${req.token}`,
                },
                searchParams: {
                    limit,
                    sort,
                    level,
                },
            }).json() as any;

        } catch(err) {
            logger.error(`Error occurred while retrieving bot information. Will update heartbeat -- ${err.message}`);
            refreshClient(clients.find(x => normalizeUrl(x.host) === bot.normalUrl) as BotConnection);
            resp = defaultBotStatus(intersect(user.subreddits, bot.subreddits));
            resp.subreddits = resp.subreddits.map(x => {
                if(x.name === 'All') {
                    x.logs = (botLogMap.get(bot.friendly) || []).map(x => formatLogLineToHtml(x[1]));
                }
                return x;
            })
        }

        if (req.query.sub !== undefined) {
            const encoded = encodeURI(req.query.sub as string).toLowerCase();
            // @ts-ignore
            const shouldShow = resp.subreddits.find(x => x.name.toLowerCase() === encoded);
            if (shouldShow !== undefined) {
                resp.show = shouldShow.name;
            } else {
                resp.show = 'All';
            }
        }

        const shownBots = user.isOperator ? bots : bots.filter(x => intersect(user.subreddits, x.subreddits).length > 0 || x.operators.includes(user.name.toLowerCase()));

        res.render('status', {
            show: 'All',
            ...resp,
            bots: shownBots.map(x => ({...x, shown: x.friendly === bot.friendly})),
            botId: bot.friendly,
            botName: bot.botName,
            botLink: bot.botLink,
            isOperator: bot.operators.includes((req.user as Express.User).name),
            operators: bot.operators.join(', '),
            operatorDisplay: bot.operatorDisplay,
            logSettings: {
                limitSelect: [10, 20, 50, 100, 200].map(x => `<option ${limit === x ? 'selected' : ''} class="capitalize ${limit === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' | '),
                sortSelect: ['ascending', 'descending'].map(x => `<option ${sort === x ? 'selected' : ''} class="capitalize ${sort === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' '),
                levelSelect: availableLevels.map(x => `<option ${level === x ? 'selected' : ''} class="capitalize log-${x} ${level === x ? `font-bold` : ''}" data-value="${x}">${x}</option>`).join(' '),
            },
        });
    });

    app.getAsync('/config', [ensureAuthenticated, defaultSession, botWithPermissions, createUserToken], async (req: express.Request, res: express.Response) => {
        const {subreddit} = req.query as any;
        const resp = await got.get(`${(req.bot as BotClient).normalUrl}/config`, {
            headers: {
                'Authorization': `Bearer ${req.token}`,
            },
            searchParams: {
                subreddit
            }
        }).text();

        const [obj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(resp);
        const bot = req.bot as BotClient;
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



        if(req.isAuthenticated()) {
            const connectedUser = connectedUsers[req.session.id];
            if(connectedUser !== undefined) {
                startLogStream(req.session, createToken(bots.find(x => x.friendly === connectedUser.botId) as BotClient, req.user));
            }
        }
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
                const bot = bots.find(x => x.friendly === session.botId);
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
                        const ac = startLogStream(session, createToken(bot, user));
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
        const existingClientIndex = bots.findIndex(x => x.normalUrl === normalized);
        const existingClient = existingClientIndex === -1 ? undefined : bots[existingClientIndex];

        let shouldCheck = false;
        if(!existingClient) {
            shouldCheck = true;
        } else if(force) {
            shouldCheck = true;
        } else  {
            const lastCheck = dayjs().diff(dayjs.unix(existingClient.lastCheck), 's');
            if((!existingClient.online || !existingClient.running)) {
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
            let botStat: BotClient = {
                ...client,
                indicator: 'gray',
                subreddits: [] as string[],
                operators: [] as string[],
                operatorDisplay: '',
                online: false,
                running: false,
                friendly: url.host,
                botName: url.host,
                botLink: normalized,
                lastCheck: dayjs().unix(),
                normalUrl: normalized,
                url,
            };
            try {
                const resp = await got.get(`${normalized}/heartbeat`, {
                    headers: {
                        'Authorization': `Bearer ${machineToken}`,
                    }
                }).json() as BotClient;

                botStat = {...botStat, ...resp, online: true};
                const sameNameIndex = bots.findIndex(x => x.friendly === botStat.friendly);
                if(sameNameIndex > -1 && sameNameIndex !== existingClientIndex) {
                    logger.warn(`Client returned a friendly name that is not unique (${botStat.friendly}), will fallback to host as friendly (${botStat.normalUrl})`);
                    botStat.friendly = botStat.normalUrl;
                }
                botStat.online = true;
                if(botStat.online) {
                    botStat.indicator = botStat.running ? 'green' : 'orange';
                } else {
                    botStat.indicator = 'red';
                }
                logger.verbose(`Heartbeat detected`, {subreddit: botStat.friendly});
            } catch (err) {
                botStat.error = err.message;
                logger.error(`Heartbeat response from ${botStat.friendly} was not ok: ${err.message}`, {subreddit: botStat.friendly});
            } finally {
                if(existingClientIndex !== -1) {
                    bots.splice(existingClientIndex, 1, botStat);
                } else {
                    bots.push(botStat);
                }
            }
        }
    }
}

export default webClient;
