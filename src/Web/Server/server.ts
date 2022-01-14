import {addAsync, Router} from '@awaitjs/express';
import express, {Request, Response, NextFunction, RequestHandler} from 'express';
import bodyParser from 'body-parser';
import {App} from "../../App";
import {Transform} from "stream";
import winston from 'winston';
import {Server as SocketServer} from 'socket.io';
import {Strategy as JwtStrategy, ExtractJwt} from 'passport-jwt';
import passport from 'passport';
import tcpUsed from 'tcp-port-used';

import {
    intersect,
    LogEntry, parseBotLogName,
    parseSubredditLogName
} from "../../util";
import {getLogger} from "../../Utils/loggerFactory";
import LoggedError from "../../Utils/LoggedError";
import {Invokee, LogInfo, OperatorConfig} from "../../Common/interfaces";
import http from "http";
import SimpleError from "../../Utils/SimpleError";
import {heartbeat} from "./routes/authenticated/applicationRoutes";
import logs from "./routes/authenticated/user/logs";
import status from './routes/authenticated/user/status';
import {actionedEventsRoute, actionRoute, configRoute, configLocationRoute, deleteInviteRoute, addInviteRoute, getInvitesRoute} from "./routes/authenticated/user";
import action from "./routes/authenticated/user/action";
import {authUserCheck, botRoute} from "./middleware";
import {opStats} from "../Common/util";
import Bot from "../../Bot";
import addBot from "./routes/authenticated/user/addBot";
import dayjs from "dayjs";
import ServerUser from "../Common/User/ServerUser";

const server = addAsync(express());
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({extended: false}));

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
const systemLogs: LogEntry[] = [];
const botLogMap: Map<string, Map<string, LogEntry[]>> = new Map();

const botSubreddits: Map<string, string[]> = new Map();

const rcbServer = async function (options: OperatorConfig) {

    const {
        operator: {
            name,
            display,
        },
        api: {
            secret: secret,
            port,
            friendly,
        }
    } = options;

    const opNames = name.map(x => x.toLowerCase());
    let app: App;

    const logger = getLogger({...options.logging});

    logger.stream().on('log', (log: LogInfo) => {
        const logEntry: LogEntry = [dayjs(log.timestamp).unix(), log];

        const {bot: botName, subreddit: subName} = log;

        if(botName === undefined) {
            systemLogs.unshift(logEntry);
            systemLogs.slice(0, 201);
        } else {
            const botLog = botLogMap.get(botName) || new Map();

            if(subName === undefined) {
                const appLogs = botLog.get('app') || [];
                appLogs.unshift(logEntry);
                botLog.set('app', appLogs.slice(0, 200 + 1));
            } else {
                let botSubs = botSubreddits.get(botName) || [];
                if(app !== undefined && (botSubs.length === 0 || !botSubs.includes(subName))) {
                    const b = app.bots.find(x => x.botName === botName);
                    if(b !== undefined) {
                        botSubs = b.subManagers.map(x => x.displayLabel);
                        botSubreddits.set(botName, botSubs);
                    }
                }
                if(botSubs.length === 0 || botSubs.includes(subName)) {
                    const subLogs = botLog.get(subName) || [];
                    subLogs.unshift(logEntry);
                    botLog.set(subName, subLogs.slice(0, 200 + 1));
                }
            }
            botLogMap.set(botName, botLog);
        }
    })

    if (await tcpUsed.check(port)) {
        throw new SimpleError(`Specified port for API (${port}) is in use or not available. Cannot start API.`);
    }

    let httpServer: http.Server,
        io: SocketServer;

    try {
        httpServer = await server.listen(port);
        io = new SocketServer(httpServer);
    } catch (err: any) {
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
            const user = new ServerUser(name, subreddits, true, false);
            return done(null, user);
            //return done(null, {machine});
        }
        const isOperator = opNames.includes(name.toLowerCase());
        // let moderatedBots: string[] = [];
        // let moderatedManagers: string[] = [];
        // let realBots: string[] = [];
        // let realManagers: string[] = [];
        // if(app !== undefined) {
        //     const modBots =  app.bots.filter(x => intersect(subreddits, x.subManagers.map(y => y.subreddit.display_name)).length > 0);
        //     moderatedBots = modBots.map(x => x.botName as string);
        //     moderatedManagers = [...new Set(modBots.map(x => x.subManagers).flat().filter(x => subreddits.includes(x.subreddit.display_name)).map(x => x.displayLabel))];
        //     realBots = isOperator ? app.bots.map(x => x.botName as string) : moderatedBots;
        //     realManagers = isOperator ? [...new Set(app.bots.map(x => x.subManagers.map(y => y.displayLabel)).flat())] : moderatedManagers
        // }

        const user = new ServerUser(name, subreddits, false, isOperator);
        return done(null, user);
        // return done(null, {
        //     name,
        //     subreddits,
        //     isOperator,
        //     machine: false,
        //     moderatedManagers,
        //     realManagers,
        //     moderatedBots,
        //     realBots,
        // });
    }));

    server.use(passport.authenticate('jwt', {session: false}));
    server.use((req, res, next) => {
        req.botApp = app;
        next();
    });

    server.getAsync('/heartbeat', ...heartbeat({name, display, friendly}));

    server.getAsync('/logs', ...logs(subLogMap));

    server.getAsync('/stats', [authUserCheck(), botRoute(false)], async (req: Request, res: Response) => {
        let bots: Bot[] = [];
        if(req.serverBot !== undefined) {
            bots = [req.serverBot];
        } else if(req.user !== undefined) {
            bots = req.user.accessibleBots(req.botApp.bots);
        }
        const resp = [];
        for(const b of bots) {
            resp.push({name: b.botName, data: await opStats(b)});
        }
        return res.json(resp);
    });
    const passLogs = async (req: Request, res: Response, next: Function) => {
        // @ts-ignore
        req.botLogs = botLogMap;
        // @ts-ignore
        req.systemLogs = systemLogs;
        next();
    }
    server.getAsync('/status', passLogs, ...status())

    server.getAsync('/config', ...configRoute);

    server.getAsync('/config/location', ...configLocationRoute);

    server.getAsync('/events', ...actionedEventsRoute);

    server.getAsync('/action', ...action);

    server.getAsync('/check', ...actionRoute);

    server.getAsync('/addBot', ...addBot());

    server.getAsync('/bot/invite', ...getInvitesRoute);

    server.postAsync('/bot/invite', ...addInviteRoute);

    server.deleteAsync('/bot/invite', ...deleteInviteRoute);

    const initBot = async (causedBy: Invokee = 'system') => {
        if (app !== undefined) {
            logger.info('A bot instance already exists. Attempting to stop event/queue processing first before building new bot.');
            await app.destroy(causedBy);
        }
        const newApp = new App(options);
        newApp.initBots(causedBy).catch((err: any) => {
            if (newApp.error === undefined) {
                newApp.error = err.message;
            }
            logger.error('Server is still ONLINE but bot cannot recover from this error and must be re-built');
            if (!err.logged || !(err instanceof LoggedError)) {
                logger.error(err);
            }
        });
        return newApp;
    }

    server.postAsync('/init', authUserCheck(), async (req, res) => {
        logger.info(`${(req.user as Express.User).name} requested the app to be re-built. Starting rebuild now...`, {subreddit: (req.user as Express.User).name});
        app = await initBot('user');
    });

    logger.info('Beginning bot init on startup...');
    app = await initBot();
};

export default rcbServer;

