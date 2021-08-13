import {addAsync, Router} from '@awaitjs/express';
import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import {App} from "../../App";
import dayjs from 'dayjs';
import {Writable, Transform} from "stream";
import winston from 'winston';
import {Server as SocketServer} from 'socket.io';
import Submission from "snoowrap/dist/objects/Submission";
import EventEmitter from "events";
import {Strategy as JwtStrategy, ExtractJwt} from 'passport-jwt';
import passport from 'passport';
import tcpUsed from 'tcp-port-used';

import {
    boolToString, cacheStats,
    COMMENT_URL_ID, createCacheManager,
    filterLogBySubreddit,
    formatLogLineToHtml, formatNumber,
    isLogLineMinLevel,
    LogEntry, parseFromJsonOrYamlToObject,
    parseLinkIdentifier,
    parseSubredditLogName, parseSubredditName,
    pollingInfo, SUBMISSION_URL_ID
} from "../../util";
import {Manager} from "../../Subreddit/Manager";
import {getLogger} from "../../Utils/loggerFactory";
import LoggedError from "../../Utils/LoggedError";
import {OperatorConfig, ResourceStats, RUNNING, STOPPED, SYSTEM, USER} from "../../Common/interfaces";
import http from "http";
import SimpleError from "../../Utils/SimpleError";
import {booleanMiddle} from "../Common/middleware";
import pEvent from "p-event";
import {BotStats, BotStatusResponse} from '../Common/interfaces';
import {heartbeat} from "./routes/authenticated/applicationRoutes";
import logs from "./routes/authenticated/user/logs";
import status from './routes/authenticated/user/status';
import {actionRoute, configRoute} from "./routes/authenticated/user";
import action from "./routes/authenticated/user/action";

const app = addAsync(express());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

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

const rcbServer = async function (options: OperatorConfig) {

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
        api: {
            secret: secret,
            port
        }
    } = options;

    const opNames = name.map(x => x.toLowerCase());
    let bot: App;
    let botSubreddits: string[] = [];

    const winstonStream = new Transform({
        transform(chunk, encoding, callback) {
            // remove newline (\n) from end of string since we deal with it with css/html
            const logLine = chunk.toString().slice(0, -1);
            const now = Date.now();
            const logEntry: LogEntry = [now, logLine];

            const subName = parseSubredditLogName(logLine);
            if (subName !== undefined && (botSubreddits.length === 0 || botSubreddits.includes(subName))) {
                const subLogs = subLogMap.get(subName) || [];
                subLogs.unshift(logEntry);
                subLogMap.set(subName, subLogs.slice(0, 200 + 1));
            } else {
                const appLogs = subLogMap.get('app') || [];
                appLogs.unshift(logEntry);
                subLogMap.set('app', appLogs.slice(0, 200 + 1));
            }
            callback(null, logLine);
        }
    });

    const streamTransport = new winston.transports.Stream({
        stream: winstonStream,
    });

    const logger = getLogger({...options.logging});

    logger.add(streamTransport);

    let error: string;
    // need to return App to main so that we can handle app shutdown on SIGTERM and discriminate between normal shutdown and crash on error
    try {
        bot = new App(options);
    } catch (err) {
        error = err.message;
    }

    if (await tcpUsed.check(port)) {
        throw new SimpleError(`Specified port for API (${port}) is in use or not available. Cannot start API.`);
    }

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

    logger.info(`API started => localhost:${port}`);

    passport.use(new JwtStrategy({
        secretOrKey: secret,
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    }, function (jwtPayload, done) {
        const {name, subreddits = [], machine = true} = jwtPayload.data;
        if (machine) {
            return done(null, {machine});
        }
        const isOperator = opNames.includes(name.toLowerCase());
        const moderatedManagers = bot !== undefined ? bot.subManagers.filter(x => subreddits.includes(x.subreddit.display_name)).map(x => x.displayLabel) : [];
        let realManagers: string[] = [];
        if(bot !== undefined) {
            realManagers = isOperator ? bot.subManagers.map(x => x.displayLabel) : moderatedManagers;
        }

        return done(null, {
            name,
            subreddits,
            isOperator,
            moderatedManagers,
            realManagers,
        });
    }));

    app.use(passport.authenticate('jwt', {session: false}));
    app.use((req, res, next) => {
        req.botApp = bot;
        next();
    });

    app.getAsync('/heartbeat', ...heartbeat({name, display}));

    app.getAsync('/logs', ...logs(subLogMap));

    app.getAsync('/stats', async (req: Request, res: Response) => {
        return res.json(opStats(bot));
    });

    app.getAsync('/status', ...status(subLogMap))

    app.getAsync('/config', ...configRoute);

    app.getAsync('/action', ...action);

    app.getAsync('/check', ...actionRoute);


    try {
        // @ts-ignore
        if(bot !== undefined) {
            await bot.testClient();
            await bot.buildManagers();
            botSubreddits = bot.subManagers.map(x => x.displayLabel);
        }
    } catch (err) {
        // TODO eventually allow re-creating bot from api request
        logger.error('Server is still ONLINE but bot cannot recover from this error. The server must be restarted.')
        if(!err.logged || !(err instanceof LoggedError)) {
            logger.error(err);
        }
    }
    // @ts-ignore
    if(bot !== undefined) {
        await bot.runManagers();
    }
};

const opStats = (bot: App): BotStats => {
    const limitReset = dayjs(bot.client.ratelimitExpiration);
    const nextHeartbeat = bot.nextHeartbeat !== undefined ? bot.nextHeartbeat.local().format('MMMM D, YYYY h:mm A Z') : 'N/A';
    const nextHeartbeatHuman = bot.nextHeartbeat !== undefined ? `in ${dayjs.duration(bot.nextHeartbeat.diff(dayjs())).humanize()}` : 'N/A'
    return {
        startedAtHuman: `${dayjs.duration(dayjs().diff(bot.startedAt)).humanize()}`,
        nextHeartbeat,
        nextHeartbeatHuman,
        apiLimit: bot.client.ratelimitRemaining,
        apiAvg: formatNumber(bot.apiRollingAvg),
        nannyMode: bot.nannyMode || 'Off',
        apiDepletion: bot.apiEstDepletion === undefined ? 'Not Calculated' : bot.apiEstDepletion.humanize(),
        limitReset: limitReset.format(),
        limitResetHuman: `in ${dayjs.duration(limitReset.diff(dayjs())).humanize()}`,
    }
}

export default rcbServer;

