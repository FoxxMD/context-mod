import {addAsync, Router} from "@awaitjs/express";
import express, {Request, Response} from "express";
import bodyParser from "body-parser";
import cookieParser from 'cookie-parser';
// @ts-ignore
import CacheManagerStore from 'express-session-cache-manager'
import passport from 'passport';
import {Strategy as CustomStrategy} from 'passport-custom';
import {OperatorConfig, WebClient} from "../../Common/interfaces";
import {
    createCacheManager, filterLogBySubreddit,
    formatLogLineToHtml,
    intersect,
    LogEntry,
    parseSubredditLogName,
    randomId, sleep
} from "../../util";
import {Cache} from "cache-manager";
import session, {Session, SessionData} from "express-session";
import Snoowrap, {Subreddit} from "snoowrap";
import {getLogger} from "../../Utils/loggerFactory";
import EventEmitter from "events";
import {Readable, Writable} from "stream";
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

const emitter = new EventEmitter();
const stream = new Writable()

const app = addAsync(express());
const router = Router();

app.use(router);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(cookieParser());
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
    }
}

declare global {
    namespace Express {
        interface User {
            name: string
            subreddits: string[]
            machine?: boolean
            isOperator?: boolean
            usableSubreddits?: string[]
        }
    }
}

declare module 'express' {
    interface Request {
        token?: string,
        bot?: BotClient,
        usableSubreddits?: string[]
    }
}

const reqClient = async (req: Request, res: Response, next: Function) => {
    const {bot} = req.query;
    if (bot === '' || bot === undefined) {
        res.status(400);
        res.send(`Expected a 'bot' identifier`);
    }
    next();
}

interface BotClient extends WebClient {
    friendly: string
    online: boolean
    lastCheck: number
    error?: string
    subreddits: string[]
    operators: string[]
    nanny?: string
    running: boolean
    url: URL,
    normalUrl: string,
}

interface ConnectedUserInfo {
    level?: string,
    user?: string,
    botId: string,
    logStream?: GotRequest
    opStream?: GotRequest
}

interface ConnectUserObj {
    [key: string]: ConnectedUserInfo
}

const connectedUsers: ConnectUserObj = {};

const createToken = (bot: BotClient, user?: Express.User, ) => {
    const payload = user !== undefined ? {...user, machine: false} : {machine: true};
    return jwt.sign({
        data: payload,
    }, bot.secret, {
        expiresIn: '1m'
    });
}

const webClient = async (options: OperatorConfig) => {
    const {
        credentials: {
            clientId,
            clientSecret,
            redirectUri
        },
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
        },
    } = options;

    stream._write = (chunk, encoding, next) => {
        // remove newline (\n) from end of string since we deal with it with css/html
        const logLine = chunk.toString().slice(0, -1);
        const now = Date.now();
        const logEntry: LogEntry = [now, logLine];

        emitter.emit('log', logLine);
        next();
    }

    const streamTransport = new winston.transports.Stream({
        stream,
    })

    const logger = getLogger({defaultLabel: 'Web', ...options.logging, additionalTransports: [streamTransport]}, 'Web');

    if (await tcpUsed.check(port)) {
        throw new SimpleError(`Specified port for web interface (${port}) is in use or not available. Cannot start web server.`);
    }

    if (provider.store === 'none') {
        logger.warn(`Cannot use 'none' for session store or else no one can use the interface...falling back to 'memory'`);
        provider.store = 'memory';
    }
    const webCache = createCacheManager(provider) as Cache;

    //<editor-fold desc=Session and Auth>
    /*
    * Session and Auth
    * */

    passport.serializeUser(async function (data: any, done) {
        const {user, subreddits} = data;
        await webCache.set(`userSession-${user}`, { subreddits: subreddits.map((x: Subreddit) => x.display_name) }, {ttl: provider.ttl as number});
        done(null, user);
    });

    passport.deserializeUser(async function (obj, done) {
        const data = await webCache.get(`userSession-${obj}`) as object;
        if (data === undefined) {
            done('Not Found');
        }

        done(null, {...data, name: obj as string} as Express.User);
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
            return next();
        }
        res.redirect('/login');
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

    app.getAsync(/.*callback$/, passport.authenticate('snoowrap', {
        successRedirect: '/',
        failureRedirect: '/error'
    }), (err: any, req: express.Request, res: express.Response, next: Function) => {
        if (err !== null) {
            return res.render('error', {error: err});
        }
        req.session.limit = 200;
        req.session.level = 'debug';
        req.session.sort = 'descending';
        return res.redirect('/');
    });

    app.getAsync('/logout', async (req, res) => {
        // @ts-ignore
        req.session.destroy();
        req.logout();
        res.send('Bye!');
    });
    //</editor-fold>

    const bots: BotClient[] = [];

    let server: http.Server,
        io: SocketServer;

    const startLogStream = (sessionData: Session & Partial<SessionData>, token: string) => {
        // @ts-ignore
        const sessionId = sessionData.id as string;
        
        if(connectedUsers[sessionId] !== undefined) {

            const currBot = bots.find(x => x.friendly === connectedUsers[sessionId].botId);
            if(currBot !== undefined) {
                const l = connectedUsers[sessionId].logStream;
                if(l !== undefined && !l.destroyed) {
                    l.destroy();
                }
                const s = got.stream.get(`${currBot.normalUrl}/logs`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                    searchParams: {
                        limit: sessionData.limit,
                        sort: sessionData.sort,
                        level: sessionData.level,
                        stream: true
                    }
                });
                s.on('data', (c) => {
                    io.to(sessionId).emit('log', formatLogLineToHtml(c.toString()));
                });
                s.on('destroy', () => {
                    console.log('destroying');
                })
                connectedUsers[sessionId] = {logStream: s, botId: currBot.friendly}
            }
        }
    }

    const startOpStream = (sessionData: Session & Partial<SessionData>, token: string) => {
        const sessionId = sessionData.id as string;

        if(connectedUsers[sessionId] !== undefined) {

            const currBot = bots.find(x => x.friendly === connectedUsers[sessionId].botId);
            if(currBot !== undefined) {

                const l = connectedUsers[sessionId].opStream;
                if(l !== undefined && !l.destroyed) {
                    l.destroy();
                }
                const s = got.stream.get(`${currBot.normalUrl}/opStats`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                    searchParams: {
                        limit: sessionData.limit,
                        sort: sessionData.sort,
                        level: sessionData.level,
                        stream: true
                    }
                });
                s.on('data', (c) => {
                    io.to(sessionId).emit('opStats', formatLogLineToHtml(c.toString()));
                });
                s.on('destroy', () => {
                    console.log('destroying');
                })
                connectedUsers[sessionId] = {logStream: s, botId: currBot.friendly}
            }
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
        const msg = 'Bot does not exist or you do not have permission to access it';
        const bot = bots.find(x => x.friendly === req.params.botId);
        if (bot === undefined) {
            return res.render('error', {error: msg});
        }

        const user = req.user as Express.User;

        const isOperator = bot.operators.includes(user.name);
        if (!isOperator && intersect(user.subreddits, bot.subreddits).length === 0) {
            return res.render('error', {error: msg});
        }

        if (req.params.subreddit !== undefined && !isOperator && !user.subreddits.includes(req.params.subreddit)) {
            return res.render('error', {error: msg});
        }
        req.bot = bot;
        next();
    }

    const createUserToken = async (req: express.Request, res: express.Response, next: Function) => {
        req.token = createToken(req.bot as BotClient, req.user);
        next();
    }


    app.useAsync('/bot/:botId/api/', [ensureAuthenticated, botWithPermissions, createUserToken], (req: express.Request, res: express.Response) => {
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

    app.getAsync('/bot/:botId', [ensureAuthenticated, botWithPermissions, createUserToken], async (req: express.Request, res: express.Response) => {
        const resp = await got.get(`${(req.bot as BotClient).normalUrl}/status`, {
            headers: {
                'Authorization': `Bearer ${req.token}`,
            },
            searchParams: {
                limit: req.session.limit,
                sort: req.session.sort,
                level: req.session.level,
            },
        }).json() as object;
        res.render('status', {...resp, botId: req.params.botId});

        if(req.isAuthenticated()) {
            connectedUsers[req.session.id] = {
                botId: req.params.botId
            }
            startLogStream(req.session, req.token as string);
        }
    });

    // app.getAsync('/bot/:botId/config', [ensureAuthenticated, botWithPermissions, createUserToken], async (req: express.Request, res: express.Response) => {
    //     const resp = await got.get(`${(req.bot as BotClient).normalUrl}/config`, {
    //         headers: {
    //             'Authorization': `Bearer ${req.token}`,
    //         },
    //     }).json() as object;
    //     res.render('status', {...resp, botId: req.params.botId});
    //
    //     if(req.isAuthenticated()) {
    //         connectedUsers[req.session.id] = {
    //             botId: req.params.botId
    //         }
    //         startLogStream(req.session, req.token as string);
    //     }
    // });

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

    app.getAsync('/', ensureAuthenticated, async (req, res) => {
        // if user doesn't specify bot in url we will find the first that is accessible and online
        const accessibleBot = bots.find(x => {
            return x.online && (x.operators.includes((req.user as Express.User).name) || intersect((req.user as Express.User).subreddits, x.subreddits).length > 0);
        })
        if(accessibleBot === undefined) {
            // oops, deal with this in a sec
            res.send(500);
        }
        return res.redirect(`/bot/${accessibleBot?.friendly}`);
    });

    io.use(sharedSession(sessionObj));

    io.on("connection", function (socket) {
        // @ts-ignore
        if (socket.handshake.session.passport !== undefined && socket.handshake.session.passport.user !== undefined) {
            // @ts-ignore
            socket.join(socket.handshake.session.id);
            // @ts-ignore
            // connectedUsers.set(socket.handshake.session.id, {
            //     // @ts-ignore
            //     user: socket.handshake.session.user
            // });

            // @ts-ignore
            // if (opNames.includes(socket.handshake.session.passport.user.toLowerCase())) {
            //     // @ts-ignore
            //     operatorSessionIds.push(socket.handshake.session.id)
            // }
        }
    });
    io.on('disconnect', (socket) => {

        if(connectedUsers[socket.handshake.session.id] !== undefined) {
            const l = connectedUsers[socket.handshake.session.id].logStream;
            if(l !== undefined && !l.destroyed) {
                l.destroy();
            }
            const o = connectedUsers[socket.handshake.session.id].opStream;
            if(o !== undefined && !o.destroyed) {
                o.destroy();
            }
            delete connectedUsers[socket.handshake.session.id];
        }
        // const currIo = connectedUsers.get(socket.handshake.session.id);
        // if(currIo !== undefined) {
        //     currIo.logStream.end();
        // }
        // connectedUsers.delete(socket.handshake.session.id);
        //operatorSessionIds = operatorSessionIds.filter(x => x !== socket.handshake.session.id)
    });

    // try to contact clients
    for(const c of clients) {
        const machineToken = jwt.sign({
            data: {
                machine: true,
            },
        }, c.secret, {
            expiresIn: '1m'
        });
        let base = `${c.host}${c.port !== undefined ? `:${c.port}` : ''}`;
        const normalized = normalizeUrl(base);
        const url = new URL(normalized);
        let botStat: BotClient = {
            ...c,
            subreddits: [] as string[],
            operators: [] as string[],
            online: false,
            running: false,
            friendly: url.host,
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
           botStat.online = true;
        } catch (err) {
            logger.error(err);
        } finally {
            bots.push(botStat);
        }
    }
}

export default webClient;
