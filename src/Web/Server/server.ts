import {addAsync} from '@awaitjs/express';
import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import {App} from "../../App";
import {Server as SocketServer} from 'socket.io';
import {ExtractJwt, Strategy as JwtStrategy} from 'passport-jwt';
import passport from 'passport';
import tcpUsed from 'tcp-port-used';
import {getLogger} from "../../Utils/loggerFactory";
import LoggedError from "../../Utils/LoggedError";
import {LogInfo, OperatorConfigWithFileContext, RUNNING, STOPPED} from "../../Common/interfaces";
import http from "http";
import {heartbeat} from "./routes/authenticated/applicationRoutes";
import logs from "./routes/authenticated/user/logs";
import status from './routes/authenticated/user/status';
import liveStats, {opStatResponse} from './routes/authenticated/user/liveStats';
import {
    actionedEventsRoute,
    actionRoute, addGuestModRoute,
    cancelDelayedRoute,
    configLocationRoute,
    configRoute,
    removeGuestModRoute, saveGuestWikiEditRoute, removalReasonsRoute
} from "./routes/authenticated/user";
import action from "./routes/authenticated/user/action";
import {authUserCheck, botRoute} from "./middleware";
import Bot from "../../Bot";
import addBot from "./routes/authenticated/user/addBot";
import ServerUser from "../Common/User/ServerUser";
import {CMError, SimpleError} from "../../Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {Manager} from "../../Subreddit/Manager";
import {MESSAGE} from "triple-beam";
import dayjs from "dayjs";
import { sleep } from '../../util';
import {Invokee} from "../../Common/Infrastructure/Atomic";
import {Point} from "@influxdata/influxdb-client";
import {
    acceptSubredditInviteRoute,
    addBotInviteRoute,
    addSubredditInviteRoute,
    deleteSubredditInviteRoute,
    getBotInviteRoute,
    getSubredditInviteRoute,
    getSubredditInvitesRoute
} from "./routes/authenticated/user/invites";

const server = addAsync(express());
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({extended: false}));

server.use((req, res, next) => {
    // https://developers.google.com/search/docs/advanced/crawling/block-indexing#http-response-header
    res.setHeader('X-Robots-Tag', 'noindex');
    next();
});

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
            if(sysLogs.length > 200) {
                sysLogs.splice(200);
            }
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
        req.logger = logger;
        next();
    });

    server.getAsync('/heartbeat', ...heartbeat({name, display, friendly}));

    server.getAsync('/logs', ...logs());

    server.getAsync('/stats', ...opStatResponse());

    const passLogs = async (req: Request, res: Response, next: Function) => {
        // @ts-ignore
        req.sysLogs = sysLogs;
        next();
    }
    server.getAsync('/status', passLogs, ...status())

    server.getAsync('/liveStats', ...liveStats())

    server.getAsync('/config', ...configRoute);

    server.getAsync('/config/location', ...configLocationRoute);

    server.postAsync('/config', ...saveGuestWikiEditRoute);

    server.getAsync('/reasons', ...removalReasonsRoute);

    server.getAsync('/events', ...actionedEventsRoute);

    server.getAsync('/action', ...action);

    server.getAsync('/check', ...actionRoute);

    server.postAsync('/bot', ...addBot());

    server.getAsync('/bot/invite', ...getSubredditInvitesRoute);

    server.getAsync('/bot/invite/:id', ...getSubredditInviteRoute);

    server.postAsync('/bot/invite/:id', ...acceptSubredditInviteRoute);

    server.postAsync('/bot/invite', ...addSubredditInviteRoute);

    server.deleteAsync('/bot/invite', ...deleteSubredditInviteRoute);

    server.deleteAsync('/delayed', ...cancelDelayedRoute);

    server.deleteAsync('/guests', ...removeGuestModRoute);

    server.postAsync('/guests', ...addGuestModRoute);

    server.getAsync('/invites/:id', ...getBotInviteRoute);

    server.postAsync('/invites', ...addBotInviteRoute);

    app = new App(options);

    const initBot = async (causedBy: Invokee = 'system') => {
        app.initBots(causedBy).catch((err: any) => {
            if (app.error === undefined) {
                app.error = err.message;
            }
            logger.error('Server is still ONLINE but bot cannot recover from this error and must be re-built');
            if (!err.logged || !(err instanceof LoggedError)) {
                logger.error(err);
            }
        });
    }

    // would like to use node-memwatch for more stats but doesn't work with docker (alpine gclib?) and requires more gyp bindings, yuck
    // https://github.com/airbnb/node-memwatch
    const writeMemoryMetrics = async () => {
        if (options.dev.monitorMemory) {
            if (options.influx !== undefined) {
                const influx = options.influx;
                while (true) {
                    await sleep(options.dev.monitorMemoryInterval);
                    try {
                        const memUsage = process.memoryUsage();
                        await influx.writePoint(new Point('serverMemory')
                            .intField('external', memUsage.external)
                            .intField('rss', memUsage.rss)
                            .intField('arrayBuffers', memUsage.arrayBuffers)
                            .intField('heapTotal', memUsage.heapTotal)
                            .intField('heapUsed', memUsage.heapUsed)
                        );
                    } catch (e: any) {
                        logger.warn(new CMError('Error occurred while trying to collect memory metrics', {cause: e}));
                    }
                }
            } else {
                logger.warn('Cannot monitor memory because influx config was not set');
            }
        }
    }

    server.postAsync('/init', authUserCheck(), async (req, res) => {
        logger.info(`${(req.user as Express.User).name} requested the app to be re-built. Starting rebuild now...`, {subreddit: (req.user as Express.User).name});
        await initBot('user');
        res.send('OK');
    });

    server.postAsync('/database/migrate', authUserCheck(), async (req, res) => {
        // because log timestamps are only granular to seconds we need to make sure "now" is actually "before" the log statements we are about to make
        const now = dayjs().subtract(1, 'second');
        logger.info(`${(req.user as Express.User).name} invoked migrations. Starting migrations now...`, {subreddit: (req.user as Express.User).name});
        try {
            await app.doMigration();
        } finally {
            // get all by leaf
            const dbLogs = sysLogs.filter(x => x.labels?.includes('Database') && dayjs(x.timestamp).isSameOrAfter(now));

            dbLogs.reverse();
            res.status(app.ranMigrations ? 200 : 500).send(dbLogs.map(x => x[MESSAGE]).join('\r\n'));
        }
    });

    server.getAsync('/database/logs', authUserCheck(), async (req, res) => {
        const dbLogs = sysLogs.filter(x => {
            return x.labels?.includes('Database');
        });

        dbLogs.reverse();
        res.send(dbLogs.map(x => x[MESSAGE]).join('\r\n'));
    });

    server.postAsync('/database/backup', authUserCheck(), async (req, res) => {
        logger.info(`${(req.user as Express.User).name} invoked database backup. Trying to backup now...`, {subreddit: (req.user as Express.User).name});
        // because log timestamps are only granular to seconds we need to make sure "now" is actually "before" the log statements we are about to make
        const now = dayjs().subtract(1, 'second');
        let status = 200;
        try {
            await app.backupDatabase();
        } catch (e) {
            status = 500;
        }

        const dbLogs = sysLogs.filter(x => {
            const logTime = dayjs(x.timestamp);
            // @ts-ignore
            return x.leaf === 'Backup' && logTime.isSameOrAfter(now)
        });

        dbLogs.reverse();
        res.status(status).send(dbLogs.map(x => x[MESSAGE]).join('\r\n'));
    });

    logger.info('Initializing database...');
    try {
        writeMemoryMetrics();
        const dbReady = await app.initDatabase();
        if(dbReady) {
            logger.info('Initializing application...');
            await initBot();
        }
    } catch (e: any) {
        logger.error(new ErrorWithCause('Error occurred during database connection or migration. Cannot continue with starting bots.', {cause: e}));
    }
};

export default rcbServer;

