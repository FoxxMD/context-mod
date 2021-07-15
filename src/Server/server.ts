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
import {
    filterLogBySubreddit,
    formatLogLineToHtml,
    isLogLineMinLevel,
    parseSubredditLogName,
    pollingInfo
} from "../util";
import {Manager} from "../Subreddit/Manager";

const MemoryStore = createMemoryStore(session);
const app = addAsync(express());
const router = Router();

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
    const {
        clientId = process.env.CLIENT_ID,
        clientSecret = process.env.CLIENT_SECRET,
        redirectUri = process.env.REDIRECT_URI,
        sessionSecret = process.env.SESSION_SECRET || defaultSessionSecret,
        operator = process.env.OPERATOR,
        operatorDisplay = process.env.OPERATOR_DISPLAY || 'Anonymous',
        port = process.env.PORT || 8085,
    } = options;

    const bot = new App({...options, additionalTransports: [streamTransport]});
    await bot.testClient();

    const server = await app.listen(port);
    const io = new SocketServer(server);

    const logger = winston.loggers.get('default');
    logger.info(`Web UI started: http://localhost:${port}`);

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
            connectedUsers.set(socket.handshake.session.id, {
                // @ts-ignore
                subreddits: socket.handshake.session.subreddits,
                // @ts-ignore
                level: socket.handshake.session.level
            });

            // @ts-ignore
            if (operator !== undefined && socket.handshake.session.user.toLowerCase() === operator.toLowerCase()) {
                // @ts-ignore
                operatorSessionId = socket.handshake.session.id;
            }
        }
    });
    io.on('disconnect', (socket) => {
        // @ts-ignore
        connectedUsers.delete(socket.handshake.session.id);
        if (operatorSessionId === socket.handshake.session.id) {
            operatorSessionId = undefined;
        }
    });

    const redditUserMiddleware = async (req: express.Request, res: express.Response, next: Function) => {
        if (req.session.user === undefined) {
            return res.redirect('/login');
        }
        next();
    }

    app.getAsync('/logout', async (req, res) => {
        // @ts-ignore
        req.session.destroy();
        res.send('Bye!');
    })

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

        req.session['user'] = user;
        // @ts-ignore
        req.session['subreddits'] = operator !== undefined && operator.toLowerCase() === user.toLowerCase() ? bot.subManagers.map(x => x.displayLabel) : subs.reduce((acc: string[], x) => {
            const sm = bot.subManagers.find(y => y.subreddit.display_name === x.display_name);
            if (sm !== undefined) {
                return acc.concat(sm.displayLabel);
            }
            return acc;
        }, []);
        req.session['lastCheck'] = dayjs().unix();
        res.redirect('/');
    });

    app.use('/', redditUserMiddleware);
    app.getAsync('/', async (req, res) => {
        const {subreddits = [], user: userVal, limit = 200, level = 'verbose', sort = 'descending', lastCheck} = req.session;
        const user = userVal as string;
        let slicedLog = output.slice(0, limit + 1);
        if (sort === 'ascending') {
            slicedLog.reverse();
        }
        const isOperator = operator !== undefined && operator.toLowerCase() === user.toLowerCase()
        // @ts-ignore
        const logs = filterLogBySubreddit(slicedLog, req.session.subreddits, level, isOperator);
        const subManagerData = [];
        for (const s of subreddits) {
            const m = bot.subManagers.find(x => x.displayLabel === s) as Manager;
            const sd = {
                name: s,
                logs: logs.get(s),
                running: m.running,
                dryRun: m.dryRun === true,
                pollingInfo: m.pollOptions.map(pollingInfo),
                checks: {
                    submissions: m.submissionChecks.length,
                    comments: m.commentChecks.length,
                },
                wikiLocation: m.wikiLocation,
                wikiHref: `https://reddit.com/r/${m.subreddit.display_name}/wiki/${m.wikiLocation}`,
                wikiRevisionHuman: m.lastWikiRevision === undefined ? 'N/A' : `${dayjs.duration(dayjs().diff(m.lastWikiRevision)).humanize()} ago`,
                wikiRevision: m.lastWikiRevision === undefined ? 'N/A' : m.lastWikiRevision.local().format('MMMM D, YYYY h:mm A Z'),
                wikiLastCheckHuman: `${dayjs.duration(dayjs().diff(m.lastWikiCheck)).humanize()} ago`,
                wikiLastCheck: m.lastWikiCheck.local().format('MMMM D, YYYY h:mm A Z'),
                stats: m.getStats(),
                startedAt: 'Not Started',
                startedAtHuman: 'Not Started'
            };
            if (m.startedAt !== undefined) {
                sd.startedAtHuman = `${dayjs.duration(dayjs().diff(m.startedAt)).humanize()} ago`;
                sd.startedAt = m.startedAt.local().format('MMMM D, YYYY h:mm A Z');
            }
            subManagerData.push(sd);
        }
        const totalStats = subManagerData.reduce((acc, curr) => {
            return {
                checks: {
                    submissions: acc.checks.submissions + curr.checks.submissions,
                    comments: acc.checks.comments + curr.checks.comments,
                },
                eventsCheckedTotal: acc.eventsCheckedTotal + curr.stats.eventsCheckedTotal,
                checksRunTotal: acc.checksRunTotal + curr.stats.checksRunTotal,
                checksTriggeredTotal: acc.checksTriggeredTotal + curr.stats.checksTriggeredTotal,
                rulesRunTotal: acc.rulesRunTotal + curr.stats.rulesRunTotal,
                rulesCachedTotal: acc.rulesCachedTotal + curr.stats.rulesCachedTotal,
                rulesTriggeredTotal: acc.rulesTriggeredTotal + curr.stats.rulesTriggeredTotal,
                actionsRunTotal: acc.actionsRunTotal + curr.stats.actionsRunTotal,
            };
        }, {
            checks: {
                submissions: 0,
                comments: 0,
            },
            eventsCheckedTotal: 0,
            checksRunTotal: 0,
            checksTriggeredTotal: 0,
            rulesRunTotal: 0,
            rulesCachedTotal: 0,
            rulesTriggeredTotal: 0,
            actionsRunTotal: 0,
        });
        const {checks, ...rest} = totalStats;

        let allManagerData: any = {
            name: 'All',
            running: true,
            dryRun: bot.dryRun === true,
            logs: logs.get('all'),
            checks: checks,
            stats: rest,
        };
        if(isOperator) {
            allManagerData.startedAt = bot.startedAt.local().format('MMMM D, YYYY h:mm A Z');
            allManagerData.heartbeatHuman = dayjs.duration({seconds: bot.heartbeatInterval}).humanize();
            allManagerData.heartbeat = bot.heartbeatInterval;
            allManagerData = {...allManagerData, ...opStats(bot)};
        }

        const data = {
            userName: user,
            subreddits: [allManagerData, ...subManagerData],
            botName: bot.botName,
            operatorDisplay,
            isOperator,
            logSettings: {
                limit: [10, 20, 50, 100, 200].map(x => `<a class="capitalize ${limit === x ? 'font-bold no-underline pointer-events-none' : ''}" data-limit="${x}" href="logs/settings/update?limit=${x}">${x}</a>`).join(' | '),
                sort: ['ascending', 'descending'].map(x => `<a class="capitalize ${sort === x ? 'font-bold no-underline pointer-events-none' : ''}" data-sort="${x}" href="logs/settings/update?sort=${x}">${x}</a>`).join(' | '),
                level: availableLevels.map(x => `<a class="capitalize log-${x} ${level === x ? `font-bold no-underline pointer-events-none` : ''}" data-log="${x}" href="logs/settings/update?level=${x}">${x}</a>`).join(' | ')
            },
        };

        res.render('status', data);
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
            subArr.push({name: k, logs: v.join('')});
        });
        io.emit('logClear', subArr);
    });

    emitter.on('log', (log) => {
        const emittedSessions = [];
        const subName = parseSubredditLogName(log);
        if (subName !== undefined) {
            for (const [id, info] of connectedUsers) {
                const {subreddits, level = 'verbose'} = info;
                if (isLogLineMinLevel(log, level) && subreddits.includes(subName)) {
                    emittedSessions.push(id);
                    io.to(id).emit('log', formatLogLineToHtml(log));
                }
            }
        }
        if (operatorSessionId !== undefined) {
            io.to(operatorSessionId).emit('opStats', opStats(bot));
            if (subName === undefined || !emittedSessions.includes(operatorSessionId)) {
                const {level = 'verbose'} = connectedUsers.get(operatorSessionId) || {};
                if (isLogLineMinLevel(log, level)) {
                    io.to(operatorSessionId).emit('log', formatLogLineToHtml(log));
                }
            }
        }
    });

    await bot.runManagers();
};

const opStats = (bot: App) => {
    const limitReset = dayjs(bot.client.ratelimitExpiration);
    const nextHeartbeat = bot.nextHeartbeat !== undefined ? bot.nextHeartbeat.local().format('MMMM D, YYYY h:mm A Z') : 'N/A';
    const nextHeartbeatHuman = bot.nextHeartbeat !== undefined ? `in ${dayjs.duration(bot.nextHeartbeat.diff(dayjs())).humanize()}` : 'N/A'
    return {
        startedAtHuman: `${dayjs.duration(dayjs().diff(bot.startedAt)).humanize()} ago`,
        nextHeartbeat,
        nextHeartbeatHuman,
        apiLimit: bot.client.ratelimitRemaining,
        limitReset,
        limitResetHuman: `in ${dayjs.duration(limitReset.diff(dayjs())).humanize()}`
    }
}

export default rcbServer;

