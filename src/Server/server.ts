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
import Submission from "snoowrap/dist/objects/Submission";
import EventEmitter from "events";
import {
    boolToString,
    COMMENT_URL_ID,
    filterLogBySubreddit,
    formatLogLineToHtml,
    isLogLineMinLevel,
    LogEntry,
    parseLinkIdentifier,
    parseSubredditLogName,
    pollingInfo, SUBMISSION_URL_ID
} from "../util";
import {Manager} from "../Subreddit/Manager";
import {getDefaultLogger} from "../Utils/loggerFactory";
import LoggedError from "../Utils/LoggedError";

const MemoryStore = createMemoryStore(session);
const app = addAsync(express());
const router = Router();

app.use(router);
app.use(bodyParser.json());
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');

interface ConnectedUserInfo {
    subreddits: string[],
    level?: string,
    user: string
}

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

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

const subLogMap: Map<string, LogEntry[]> = new Map();

const emitter = new EventEmitter();
const stream = new Writable()

const rcbServer = async function (options: any = {}) {
    const {
        clientId = process.env.CLIENT_ID,
        clientSecret = process.env.CLIENT_SECRET,
        redirectUri = process.env.REDIRECT_URI,
        sessionSecret = process.env.SESSION_SECRET || defaultSessionSecret,
        operator = process.env.OPERATOR,
        operatorDisplay = process.env.OPERATOR_DISPLAY || 'Anonymous',
        port = process.env.PORT || 8085,
        maxLogs = 200
    } = options;

    let botSubreddits: string[] = [];

    stream._write = (chunk, encoding, next) => {
        let logLine = chunk.toString();
        const now = Date.now();
        const logEntry: LogEntry = [now, logLine];

        const subName = parseSubredditLogName(logLine);
        if (subName !== undefined && (botSubreddits.length === 0 || botSubreddits.includes(subName))) {
            const subLogs = subLogMap.get(subName) || [];
            subLogs.unshift(logEntry);
            subLogMap.set(subName, subLogs.slice(0, maxLogs + 1));
        } else {
            const appLogs = subLogMap.get('app') || [];
            appLogs.unshift(logEntry);
            subLogMap.set('app', appLogs.slice(0, maxLogs + 1));
        }

        emitter.emit('log', logLine);
        next();
    }
    const streamTransport = new winston.transports.Stream({
        stream,
    })

    const logger = getDefaultLogger({...options, additionalTransports: [streamTransport]})

    const bot = new App({...options, additionalTransports: [streamTransport]});
    await bot.testClient();

    const server = await app.listen(port);
    const io = new SocketServer(server);

    logger.info(`Web UI started: http://localhost:${port}`);

    await bot.buildManagers();
    botSubreddits = bot.subManagers.map(x => x.displayLabel);
    // TODO potentially prune subLogMap of user keys? shouldn't have happened this early though

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
                level: socket.handshake.session.level,
                // @ts-ignore
                user: socket.handshake.session.user
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
        const {error, code} = req.query as any;
        if (error !== undefined) {
            let errContent: string;
            switch (error) {
                case 'access_denied':
                    errContent = 'You must <b>Allow</b> this application to connect in order to proceed.';
                    break;
                default:
                    errContent = error;
            }
            return res.render('error', {error: errContent, operatorDisplay });
        }
        const client = await Snoowrap.fromAuthCode({
            userAgent: `web:contextBot:web`,
            clientId,
            clientSecret,
            redirectUri,
            code: code as string,
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
        const isOperator = operator !== undefined && operator.toLowerCase() === user.toLowerCase()

        if((req.session.subreddits as string[]).length === 0 && !isOperator) {
            return res.render('noSubs', { operatorDisplay });
        }

        // @ts-ignore
        const logs = filterLogBySubreddit(subLogMap, req.session.subreddits, {level, operator, user, sort, limit});
        const subManagerData = [];
        for (const s of subreddits) {
            const m = bot.subManagers.find(x => x.displayLabel === s) as Manager;
            const sd = {
                name: s,
                logs: logs.get(s) || [], // provide a default empty value in case we truly have not logged anything for this subreddit yet
                running: `${boolToString(m.running)}${m.manuallyStopped ? ' (by user)' : ''}`,
                validConfig: boolToString(m.validConfigLoaded),
                dryRun: boolToString(m.dryRun === true),
                pollingInfo: m.pollOptions.length === 0 ? ['nothing :('] : m.pollOptions.map(pollingInfo),
                checks: {
                    submissions: m.submissionChecks === undefined ? 0 : m.submissionChecks.length,
                    comments: m.commentChecks === undefined ? 0 : m.commentChecks.length,
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
            running: 'Yes',
            dryRun: boolToString(bot.dryRun === true),
            logs: logs.get('all'),
            checks: checks,
            stats: rest,
        };
        if(allManagerData.logs === undefined) {
            // this should happen but saw an edge case where potentially did
            logger.warn(`Logs for 'all' were undefined found but should always have a default empty value`);
        }
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

        res.send('OK');

        const subMap = filterLogBySubreddit(subLogMap, req.session.subreddits, {
            level,
            operator: operator !== undefined && operator.toLowerCase() === (user as string).toLowerCase(),
            user,
            limit,
            sort: (sort as 'descending' | 'ascending'),
        });
        const subArr: any = [];
        subMap.forEach((v: string[], k: string) => {
            subArr.push({name: k, logs: v.join('')});
        });
        io.emit('logClear', subArr);
    });

    app.getAsync('/action', async (req, res) => {
        const { type, subreddit } = req.query as any;
        let subreddits: string[] = [];
        if(subreddit === 'All') {
            subreddits = req.session.subreddits as string[];
        } else if((req.session.subreddits as string[]).includes(subreddit)) {
            subreddits = [subreddit];
        }

        for(const s of subreddits) {
            const manager = bot.subManagers.find(x => x.displayLabel === s);
            if(manager === undefined) {
                logger.warn(`Manager for ${s} does not exist`, {subreddit: `/u/${req.session.user}`});
                continue;
            }
            const mLogger = manager.logger;
            mLogger.info(`/u/${req.session.user} invoked '${type}' action on ${manager.displayLabel}`);
            switch (type) {
                case 'start':
                    if (manager.running) {
                        mLogger.info('Already running');
                    } else {
                        try {
                            await manager.parseConfiguration();
                            manager.handle();
                        } catch (err) {
                            if (!(err instanceof LoggedError)) {
                                mLogger.error(err, {subreddit: manager.displayLabel});
                            }
                        }
                    }
                    break;
                case 'stop':
                    const wasRunning = manager.running;
                    await manager.stop(true);
                    if (!wasRunning) {
                        mLogger.info('Already stopped');
                    }
                    break;
                case 'reload':
                    try {
                        const wasRunning = manager.running;
                        await manager.stop();
                        await manager.parseConfiguration(true);
                        if (wasRunning) {
                            manager.handle();
                        } else {
                            mLogger.info('Must be STARTED manually since it was not running before reload');
                        }
                    } catch (err) {
                        if (!(err instanceof LoggedError)) {
                            mLogger.error(err, {subreddit: manager.displayLabel});
                        }
                    }
                    break;
            }
        }
        res.send('OK');
    });

    app.getAsync('/check', async (req, res) => {
        const {url, dryRun: dryRunVal} = req.query as any;

        let a;
        const commentId = commentReg(url);
        if (commentId !== undefined) {
            // @ts-ignore
            a = await bot.client.getComment(commentId);
        }
        if (a === undefined) {
            const submissionId = submissionReg(url);
            if (submissionId !== undefined) {
                // @ts-ignore
                a = await bot.client.getSubmission(submissionId);
            }
        }

        if(a === undefined) {
            logger.error('Could not parse Comment or Submission ID from given URL', {subreddit: `/u/${req.session.user}`});
            return res.send('OK');
        } else {
            // @ts-ignore
            const activity = await a.fetch();
            const sub = await activity.subreddit.display_name;
            // find manager so we can get display label
            const manager = bot.subManagers.find(x => x.subreddit.display_name === sub);
            if(manager === undefined) {
                logger.error('Cannot run check on subreddit you do not moderate or bot does not run on', {subreddit: `/u/${req.session.user}`});
                return res.send('OK');
            }
            if(!(req.session.subreddits as string[]).includes(manager.displayLabel)) {
                logger.error('Cannot run check on subreddit you do not moderate or bot does not run on', {subreddit: `/u/${req.session.user}`});
                return res.send('OK');
            }
            manager.logger.info(`/u/${req.session.user} running check on ${url}`);
            await manager.runChecks(activity instanceof Submission ? 'Submission' : 'Comment', activity, { dryRun: dryRunVal.toString() === "1" ? true : undefined })
        }
        res.send('OK');
    })

    setInterval(() => {
        // refresh op stats every 30 seconds
        if (operatorSessionId !== undefined) {
            io.to(operatorSessionId).emit('opStats', opStats(bot));
        }
    }, 30000);

    emitter.on('log', (log) => {
        const emittedSessions = [];
        const subName = parseSubredditLogName(log);
        if (subName !== undefined) {
            for (const [id, info] of connectedUsers) {
                const {subreddits, level = 'verbose', user} = info;
                if (isLogLineMinLevel(log, level) && (subreddits.includes(subName) || subName.includes(user))) {
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

