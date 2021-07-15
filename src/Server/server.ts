import {addAsync, Router} from '@awaitjs/express';
import express from 'express';
import bodyParser from 'body-parser';
import session from 'express-session';
import createMemoryStore from 'memorystore';
import Snoowrap from "snoowrap";
import crypto from 'crypto';
import {App} from "../App";
import dayjs from 'dayjs';
import {Writable} from "stream";
import winston from 'winston';
import {Server as SocketServer} from 'socket.io';
import sharedSession from 'express-socket.io-session';
import EventEmitter from "events";
import {filterLogBySubreddit, formatLogLineToHtml, isLogLineMinLevel, parseSubredditLogName} from "../util";
import {Manager} from "../Subreddit/Manager";

const MemoryStore = createMemoryStore(session);
const app = addAsync(express());
const router = Router();
const port = process.env.PORT ?? 8085;

app.use(router);
app.use(bodyParser.json());
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');

interface ConnectedUserInfo {
    subreddits: string[],
    level?: string
}

const connectedUsers: Map<string, ConnectedUserInfo> = new Map();

const availableLevels = ['error', 'warn', 'info', 'verbose', 'debug'];

const randomId = () => crypto.randomBytes(20).toString('hex');
let operatorSessionId: (string | undefined);
const defaultSessionSecret = randomId();

declare module 'express-session' {
    interface SessionData {
        user: string,
        accessToken: string,
        refreshToken: string,
        subreddits: string[],
        lastCheck?: number,
        limit?: number,
        sort?: string,
        level?: string,
    }
}

const emitter = new EventEmitter();
let output: string[] = []
const stream = new Writable()
stream._write = (chunk, encoding, next) => {
    let logLine = chunk.toString();
    output.unshift(logLine);
    // keep last 1000 log statements
    output = output.slice(0, 1001);
    emitter.emit('log', logLine);
    next();
}
const streamTransport = new winston.transports.Stream({
    stream,
})

const rcbServer = async function (options: any = {}) {
    const server = await app.listen(port);
    const io = new SocketServer(server);

    const {
        clientId = process.env.CLIENT_ID,
        clientSecret = process.env.CLIENT_SECRET,
        redirectUri = process.env.REDIRECT_URI,
        sessionSecret = process.env.SESSION_SECRET || defaultSessionSecret,
        operator = process.env.OPERATOR,
    } = options;

    const bot = new App({...options, additionalTransports: [streamTransport]});
    await bot.buildManagers();

    const sessionObj = session({
        cookie: {
            maxAge: 86400000,
        },
        store: new MemoryStore({
            checkPeriod: 86400000, // prune expired entries every 24h
            ttl: 86400000
        }),
        resave: false,
        saveUninitialized: false,
        secret: sessionSecret
    });

    app.use(sessionObj);
    io.use(sharedSession(sessionObj));

    io.on("connection", function (socket) {
        // @ts-ignore
        if (socket.handshake.session.user !== undefined) {
            // @ts-ignore
            socket.join(socket.handshake.session.id);
            // @ts-ignore
            connectedUsers.set(socket.handshake.session.id, {subreddits: socket.handshake.session.subreddits, level: socket.handshake.session.level});

            // @ts-ignore
            if(operator !== undefined && socket.handshake.session.user.toLowerCase() === operator.toLowerCase()) {
                // @ts-ignore
                operatorSessionId = socket.handshake.session.id;
            }
        }
    });
    io.on('disconnect', (socket) => {
        // @ts-ignore
        connectedUsers.delete(socket.handshake.session.id);
        if(operatorSessionId === socket.handshake.session.id) {
            operatorSessionId = undefined;
        }
    });

    const redditUserMiddleware = async (req: express.Request, res: express.Response, next: Function) => {
        if (req.session.accessToken === undefined) {
            return res.redirect('/login');
        }
        const {accessToken: userAT, refreshToken: userRT, lastCheck} = req.session;

        if(lastCheck !== undefined && dayjs().diff(dayjs.unix(req.session.lastCheck as number), 'm') > 5) {
            try {
                //@ts-ignore
                const client = new Snoowrap({
                    clientId,
                    clientSecret,
                    accessToken: userAT,
                    refreshToken: userRT,
                    userAgent: `web:contextBot:web`,
                });
                if(operator === undefined || (operator.toLowerCase() !== req.session.user)) {
                    const subs = await client.getModeratedSubreddits();
                    const subNames = subs.map(x => x.display_name);
                    req.session.subreddits = bot.subManagers.reduce((acc: string[], manager) => {
                        if(subNames.includes(manager.subreddit.display_name)) {
                            return acc.concat(manager.displayLabel);
                        }
                        return acc;
                    }, []);
                }
            } catch(err) {
                // some error occurred, probably token expired so redirect to login
                // @ts-ignore
                await req.session.destroy();
                res.redirect('/login');
            }
        }

        next();
    }

    app.getAsync('/login', async (req, res) => {
        const authUrl = Snoowrap.getAuthUrl({
            clientId,
            scope: ['identity', 'mysubreddits'],
            redirectUri,
            permanent: false,
        });
        return res.redirect(authUrl);
    });

    app.getAsync(/.*callback$/, async (req, res) => {
        const client = await Snoowrap.fromAuthCode({
            userAgent: `web:contextBot:web`,
            clientId,
            clientSecret,
            redirectUri,
            code: req.query.code as string,
        });
        // @ts-ignore
        const user = await client.getMe().name as string;
        const subs = await client.getModeratedSubreddits();

        req.session['accessToken'] = client.accessToken;
        req.session['refreshToken'] = client.refreshToken;
        req.session['user'] = user;
        // @ts-ignore
        req.session['subreddits'] = operator !== undefined && operator.toLowerCase() === user.toLowerCase() ? bot.subManagers.map(x => x.displayLabel) : subs.reduce((acc: string[], x) => {
            const sm = bot.subManagers.find(y => y.subreddit.display_name === x.display_name);
            if(sm !== undefined) {
                return acc.concat(sm.displayLabel);
            }
            return acc;
        }, []);
        req.session['lastCheck'] = dayjs().unix();
        res.redirect('/');
    });

    app.use('/', redditUserMiddleware);
    app.getAsync('/', async (req, res) => {
        const {subreddits = [], user, limit = 200, level = 'verbose', sort = 'descending', lastCheck} = req.session;
        let slicedLog = output.slice(0, limit + 1);
        if (sort === 'ascending') {
            slicedLog.reverse();
        }
        res.render('status', {
            userName: user,
            subreddits: req.session.subreddits,
            botName: bot.botName,
            logs: {
                // @ts-ignore
                output: filterLogBySubreddit(slicedLog, req.session.subreddits, level, operator !== undefined && operator.toLowerCase() === req.session.user.toLowerCase()),
                limit: [10, 20, 50, 100, 200].map(x => `<a class="capitalize ${limit === x ? 'font-bold no-underline pointer-events-none' : ''}" data-limit="${x}" href="logs/settings/update?limit=${x}">${x}</a>`).join(' | '),
                sort: ['ascending', 'descending'].map(x => `<a class="capitalize ${sort === x ? 'font-bold no-underline pointer-events-none' : ''}" data-sort="${x}" href="logs/settings/update?sort=${x}">${x}</a>`).join(' | '),
                level: availableLevels.map(x => `<a class="capitalize log-${x} ${level === x ? `font-bold no-underline pointer-events-none` : ''}" data-log="${x}" href="logs/settings/update?level=${x}">${x}</a>`).join(' | ')
            }
        });
    });

    app.getAsync('/logs/settings/update', async function (req, res) {
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
        const {limit = 200, level = 'verbose', sort = 'descending', user} = req.session;

        let slicedLog = output.slice(0, limit + 1);
        if (sort === 'ascending') {
            slicedLog.reverse();
        }
        res.send('OK');

        const subMap = filterLogBySubreddit(slicedLog, req.session.subreddits, level, operator !== undefined && operator.toLowerCase() === (user as string).toLowerCase());
        const subArr: any = [];
        subMap.forEach((v: string[], k: string) => {
            subArr.push({name: k, logs: v.join()});
        });
        io.emit('logClear', subArr);
    });

    emitter.on('log', (log) => {
        const emittedSessions = [];
        const subName = parseSubredditLogName(log);
        if(subName !== undefined) {
            for(const [id, info] of connectedUsers) {
                const {subreddits, level = 'verbose'} = info;
                if(isLogLineMinLevel(log, level) && subreddits.includes(subName)) {
                    emittedSessions.push(id);
                    io.to(id).emit('log', formatLogLineToHtml(log));
                }
            }
        }
        if(operatorSessionId !== undefined && (subName === undefined || !emittedSessions.includes(operatorSessionId))) {
            const {level = 'verbose'} = connectedUsers.get(operatorSessionId) || {};
            if(isLogLineMinLevel(log, level)) {
                io.to(operatorSessionId).emit('log', formatLogLineToHtml(log));
            }
        }
    });

    await bot.runManagers();
};

export default rcbServer;

