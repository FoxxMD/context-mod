import {addAsync, Router} from "@awaitjs/express";
import express, {Request, Response} from "express";
import bodyParser from "body-parser";
import cookieParser from 'cookie-parser';
// @ts-ignore
import CacheManagerStore from 'express-session-cache-manager'
import passport from 'passport';
import {Strategy as CustomStrategy} from 'passport-custom';
import {OperatorConfig, WebClient} from "../../Common/interfaces";
import {createCacheManager, LogEntry, parseSubredditLogName, randomId} from "../../util";
import {Cache} from "cache-manager";
import session from "express-session";
import Snoowrap, {Subreddit} from "snoowrap";
import {getLogger} from "../../Utils/loggerFactory";
import EventEmitter from "events";
import {Writable} from "stream";
import winston from "winston";
import tcpUsed from "tcp-port-used";
import SimpleError from "../../Utils/SimpleError";
import http from "http";
import jwt from 'jsonwebtoken';
import {Server as SocketServer} from "socket.io";
import got from 'got';
import sharedSession from "express-socket.io-session";
import dayjs from "dayjs";

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

declare module 'express-session' {
    interface SessionData {
        limit?: number,
        sort?: string,
        level?: string,
        state?: string,
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
    url: string
    token: string
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
        await webCache.set(`userSession-${user}`, subreddits.map((x: Subreddit) => x.display_name), {ttl: provider.ttl as number});
        done(null, user);
    });

    passport.deserializeUser(async function (obj, done) {
        const data = await webCache.get(`userSession-${obj}`);
        if (data === undefined) {
            done('Not Found');
        }
        // @ts-ignore
        done(null, data);
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
        return res.redirect('/');
    });

    app.getAsync('/logout', async (req, res) => {
        // @ts-ignore
        req.session.destroy();
        req.logout();
        res.send('Bye!');
    })
    //</editor-fold>

    let server: http.Server,
        io: SocketServer;

    try {
        server = await app.listen(port);
        io = new SocketServer(server);
    } catch (err) {
        logger.error('Error occurred while initializing web or socket.io server', err);
        err.logged = true;
        throw err;
    }
    logger.info(`Web UI started: http://localhost:${port}`, {label: ['Web']});

    const bots: BotClient[] = [];

    app.getAsync('/', ensureAuthenticated, async (req, res) => {
        return res.send(200);
    });

    io.use(sharedSession(sessionObj));

    io.on("connection", function (socket) {
        // @ts-ignore
        if (socket.handshake.session.user !== undefined) {
            // @ts-ignore
            socket.join(socket.handshake.session.id);
            // @ts-ignore
            connectedUsers.set(socket.handshake.session.id, {
                // @ts-ignore
                user: socket.handshake.session.user
            });

            // @ts-ignore
            if (opNames.includes(socket.handshake.session.user.toLowerCase())) {
                // @ts-ignore
                operatorSessionIds.push(socket.handshake.session.id)
            }
        }
    });
    io.on('disconnect', (socket) => {
        // @ts-ignore
        connectedUsers.delete(socket.handshake.session.id);
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
        let botStat: BotClient = {
            ...c,
            subreddits: [] as string[],
            operators: [] as string[],
            online: false,
            running: false,
            friendly: base,
            lastCheck: dayjs().unix(),
            token: machineToken,
            url: base,
        };
        try {
           const resp = await got.get(`${base}/heartbeat`, {
                headers: {
                    'Authorization': `Bearer ${machineToken}`,
                }
            }).json() as BotClient;

           botStat = {...botStat, ...resp, online: true};
           botStat.online = true;
           const s = got.stream.get(`${base}/log`, {
               headers: {
                   'Authorization': `Bearer ${machineToken}`,
               }
           });
           s.on('data', (c) => {
               logger.info(c.toString());
           });
           await s;
        } catch (err) {
            logger.error(err);
        } finally {
            bots.push(botStat);
        }
    }
}

export default webClient;
