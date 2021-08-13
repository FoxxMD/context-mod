import {addAsync, Router} from '@awaitjs/express';
import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import {App} from "../../App";
import {Transform} from "stream";
import winston from 'winston';
import {Server as SocketServer} from 'socket.io';
import {Strategy as JwtStrategy, ExtractJwt} from 'passport-jwt';
import passport from 'passport';
import tcpUsed from 'tcp-port-used';

import {
    LogEntry,
    parseSubredditLogName
} from "../../util";
import {getLogger} from "../../Utils/loggerFactory";
import LoggedError from "../../Utils/LoggedError";
import {Invokee, OperatorConfig} from "../../Common/interfaces";
import http from "http";
import SimpleError from "../../Utils/SimpleError";
import {heartbeat} from "./routes/authenticated/applicationRoutes";
import logs from "./routes/authenticated/user/logs";
import status from './routes/authenticated/user/status';
import {actionRoute, configRoute} from "./routes/authenticated/user";
import action from "./routes/authenticated/user/action";
import {authUserCheck} from "./middleware";
import {opStats} from "../Common/util";

const app = addAsync(express());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

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

    const initBot = async (causedBy: Invokee = 'system') => {
        if(bot !== undefined) {
            logger.info('A bot instance already exists. Attempting to stop event/queue processing first before building new bot.');
            await bot.destroy(causedBy);
        }
        const newBot = new App(options);
        if(newBot.error === undefined) {
            try {
                await newBot.testClient();
                await newBot.buildManagers();
                botSubreddits = newBot.subManagers.map(x => x.displayLabel);
                await newBot.runManagers();
            } catch (err) {
                if(newBot.error === undefined) {
                    newBot.error = err.message;
                }
                logger.error('Server is still ONLINE but bot cannot recover from this error and must be re-built');
                if(!err.logged || !(err instanceof LoggedError)) {
                    logger.error(err);
                }
            }
        }
        return newBot;
    }

    app.postAsync('/init', authUserCheck(), async (req, res) => {
        logger.info(`${(req.user as Express.User).name} requested the bot to be re-built. Starting rebuild now...`, {subreddit: (req.user as Express.User).name});
        bot = await initBot('user');
    });

    logger.info('Beginning bot init on startup...');
    bot = await initBot();
};

export default rcbServer;

