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
    intersect,
    LogEntry, parseFromJsonOrYamlToObject,
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
import {prettyPrintJson} from "pretty-print-json";

const emitter = new EventEmitter();
const stream = new Writable()

const app = addAsync(express());
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
    logStream?: GotRequest
    opStream?: GotRequest
    statInterval?: any,
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

const availableLevels = ['error', 'warn', 'info', 'verbose', 'debug'];

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
        },
    } = options;

    const webOps = name.map(x => x.toLowerCase());

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
        }
        next();
    });

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
                    const chunk = c.toString();
                    for(const line of chunk.split('\r\n')) {
                        io.to(sessionId).emit('log', formatLogLineToHtml(line));
                    }
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
        const bot = bots.find(x => x.friendly === req.query.bot);
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

    const defaultSession = (req: express.Request, res: express.Response, next: Function) => {
        if(req.session.limit === undefined) {
            req.session.limit = 200;
            req.session.level = 'verbose';
            req.session.sort = 'descending';
            req.session.save();
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

    app.useAsync('/api/*', [ensureAuthenticated, defaultSession, botWithPermissions, createUserToken], (req: express.Request, res: express.Response) => {
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

        let newBot = true;
        if(req.isAuthenticated() && connectedUsers[req.session.id] !== undefined && connectedUsers[req.session.id].statInterval !== undefined && connectedUsers[req.session.id].botId === req.params.botId) {
            if(connectedUsers[req.session.id] !== undefined) {
                if(connectedUsers[req.session.id].statInterval !== undefined && connectedUsers[req.session.id].botId !== req.params.botId) {
                    clearInterval(connectedUsers[req.session.id].statInterval);
                    newBot = false;
                }
            }
        }
        const bot = req.bot as BotClient;
        const resp = await got.get(`${bot.normalUrl}/status`, {
            headers: {
                'Authorization': `Bearer ${req.token}`,
            },
            searchParams: {
                limit: req.session.limit,
                sort: req.session.sort,
                level: req.session.level,
            },
        }).json() as any;

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

        const limit = req.session.limit;
        const sort = req.session.sort;
        const level = req.session.level;

        const user = req.user as Express.User;

        const shownBots = webOps.includes(user.name) ? bots : bots.filter(x => intersect(user.subreddits, x.subreddits).length > 0 || x.operators.includes(user.name));

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
                //limit: [10, 20, 50, 100, 200].map(x => `<a class="capitalize ${limit === x ? 'font-bold no-underline pointer-events-none' : ''}" data-limit="${x}" href="logs/settings/update?limit=${x}">${x}</a>`).join(' | '),
                limitSelect: [10, 20, 50, 100, 200].map(x => `<option ${limit === x ? 'selected' : ''} class="capitalize ${limit === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' | '),
                //sort: ['ascending', 'descending'].map(x => `<a class="capitalize ${sort === x ? 'font-bold no-underline pointer-events-none' : ''}" data-sort="${x}" href="logs/settings/update?sort=${x}">${x}</a>`).join(' | '),
                sortSelect: ['ascending', 'descending'].map(x => `<option ${sort === x ? 'selected' : ''} class="capitalize ${sort === x ? 'font-bold' : ''}" data-value="${x}">${x}</option>`).join(' '),
                //level: availableLevels.map(x => `<a class="capitalize log-${x} ${level === x ? `font-bold no-underline pointer-events-none` : ''}" data-log="${x}" href="logs/settings/update?level=${x}">${x}</a>`).join(' | '),
                levelSelect: availableLevels.map(x => `<option ${level === x ? 'selected' : ''} class="capitalize log-${x} ${level === x ? `font-bold` : ''}" data-value="${x}">${x}</option>`).join(' '),
            },
        });

        if(req.isAuthenticated()) {
            connectedUsers[req.session.id] = {
                botId: bot.friendly
            }
            if(newBot) {

                const u = req.user;
                const b = req.bot as BotClient;
                const sessionId = req.session.id;
                connectedUsers[req.session.id].statInterval = setInterval(async () => {
                    const resp = await got.get(`${b.normalUrl}/stats`, {
                        headers: {
                            'Authorization': `Bearer ${createToken(b, u)}`,
                        }
                    }).json() as object;
                    io.to(sessionId).emit('opStats', resp);
                }, 5000);
            }
            startLogStream(req.session, req.token as string);
        }
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

    io.use(sharedSession(sessionObj));

    io.on("connection", function (socket) {
        // @ts-ignore
        if (socket.handshake.session.passport !== undefined && socket.handshake.session.passport.user !== undefined) {
            // @ts-ignore
            socket.join(socket.handshake.session.id);
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
    });

    const refreshClient = async (client: BotConnection, force = false) => {
        const normalized = normalizeUrl(client.host);
        const existingClientIndex = bots.findIndex(x => x.normalUrl === normalized);
        const existingClient = existingClientIndex === -1 ? undefined : bots[existingClientIndex];
        if(!existingClient || (existingClient && (force || dayjs().diff(dayjs.unix(existingClient.lastCheck), 's') > 300)))
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
                indicator: 'grey',
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
            } catch (err) {
                botStat.error = err.message;
                logger.error(err);
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
