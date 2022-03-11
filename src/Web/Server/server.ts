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

import {getLogger} from "../../Utils/loggerFactory";
import LoggedError from "../../Utils/LoggedError";
import {Invokee, LogInfo, OperatorConfigWithFileContext, RUNNING, STOPPED} from "../../Common/interfaces";
import http from "http";
import {heartbeat} from "./routes/authenticated/applicationRoutes";
import logs from "./routes/authenticated/user/logs";
import status from './routes/authenticated/user/status';
import liveStats from './routes/authenticated/user/liveStats';
import {actionedEventsRoute, actionRoute, configRoute, configLocationRoute, deleteInviteRoute, addInviteRoute, getInvitesRoute} from "./routes/authenticated/user";
import action from "./routes/authenticated/user/action";
import {authUserCheck, botRoute} from "./middleware";
import {opStats} from "../Common/util";
import Bot from "../../Bot";
import addBot from "./routes/authenticated/user/addBot";
import ServerUser from "../Common/User/ServerUser";
import {SimpleError} from "../../Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {Manager} from "../../Subreddit/Manager";

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

let sysLogs: LogInfo[] = [];

const rcbServer = async function (options: OperatorConfigWithFileContext) {

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

        const {bot: botName, subreddit: subName} = log;

        if(botName === undefined && subName === undefined) {
            sysLogs.unshift(log);
            sysLogs = sysLogs.slice(0, 201);
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
        throw new ErrorWithCause('[Server] Error occurred while initializing web or socket.io server', {cause: err});
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

    server.getAsync('/logs', ...logs());

    server.getAsync('/stats', [authUserCheck(), botRoute(false)], async (req: Request, res: Response) => {
        let bots: Bot[] = [];
        if(req.serverBot !== undefined) {
            bots = [req.serverBot];
        } else if(req.user !== undefined) {
            bots = req.user.accessibleBots(req.botApp.bots);
        }
        const resp = [];
        let index = 1;
        for(const b of bots) {
            resp.push({name: b.botName ?? `Bot ${index}`, data: {
                    status: b.running ? 'RUNNING' : 'NOT RUNNING',
                    indicator: b.running ? 'green' : 'red',
                    running: b.running,
                    startedAt: b.startedAt.local().format('MMMM D, YYYY h:mm A Z'),
                    error: b.error,
                    subreddits: req.user?.accessibleSubreddits(b).map((manager: Manager) => {
                        let indicator;
                        if (manager.botState.state === RUNNING && manager.queueState.state === RUNNING && manager.eventsState.state === RUNNING) {
                            indicator = 'green';
                        } else if (manager.botState.state === STOPPED && manager.queueState.state === STOPPED && manager.eventsState.state === STOPPED) {
                            indicator = 'red';
                        } else {
                            indicator = 'yellow';
                        }
                        return {
                            name: manager.displayLabel,
                            indicator,
                        };
                    }),
                }});
            index++;
        }
        return res.json(resp);
    });
    const passLogs = async (req: Request, res: Response, next: Function) => {
        // @ts-ignore
        req.sysLogs = sysLogs;
        next();
    }
    server.getAsync('/status', passLogs, ...status())

    server.getAsync('/liveStats', ...liveStats())

    server.getAsync('/config', ...configRoute);

    server.getAsync('/config/location', ...configLocationRoute);

    server.getAsync('/events', ...actionedEventsRoute);

    server.getAsync('/action', ...action);

    server.getAsync('/check', ...actionRoute);

    server.postAsync('/bot', ...addBot());

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

