import {Router} from '@awaitjs/express';
import {Request, Response} from 'express';
import {
    filterLogBySubreddit,
    filterLogs,
    isLogLineMinLevel,
    LogEntry,
    parseSubredditLogName
} from "../../../../../util";
import {Transform} from "stream";
import winston from "winston";
import pEvent from "p-event";
import {getLogger} from "../../../../../Utils/loggerFactory";
import {booleanMiddle} from "../../../../Common/middleware";
import {authUserCheck, botRoute, subredditRoute} from "../../../middleware";
import {LogInfo} from "../../../../../Common/interfaces";
import {MESSAGE} from "triple-beam";
import {Manager} from "../../../../../Subreddit/Manager";
import Bot from "../../../../../Bot";

// TODO update logs api
const logs = () => {
    const middleware = [
        authUserCheck(),
        botRoute(false),
        subredditRoute(false),
        booleanMiddle([{
            name: 'stream',
            defaultVal: false
        }, {
            name: 'formatted',
            defaultVal: true,
        }, {
            name: 'transports',
            defaultVal: false
        }])
    ];

    const response = async (req: Request, res: Response) => {

        const logger = winston.loggers.get('app');

        const userName = req.user?.name as string;
        const isOperator = req.user?.isInstanceOperator(req.botApp);
        const realManagers = req.botApp.bots.map(x => req.user?.accessibleSubreddits(x).map(x => x.displayLabel)).flat() as string[];
        const {level = 'verbose', stream, limit = 200, sort = 'descending', streamObjects = false, formatted: formattedVal = true, transports: transportsVal = false} = req.query;

        const formatted = formattedVal as boolean;
        const transports = transportsVal as boolean;

        let bots: Bot[] = [];
        if(req.serverBot !== undefined) {
            bots = [req.serverBot];
        } else {
            bots = req.user?.accessibleBots(req.botApp.bots) as Bot[];
        }

        let managers: Manager[] = [];

        if(req.manager !== undefined) {
            managers = [req.manager];
        } else {
            for(const b of bots) {
                managers = managers.concat(req.user?.accessibleSubreddits(b) as Manager[]);
            }
        }

        //const allReq = req.query.subreddit !== undefined && (req.query.subreddit as string).toLowerCase() === 'all';

        if (stream) {

            const requestedManagers = managers.map(x => x.displayLabel);
            const requestedBots = bots.map(x => x.botName);

            const origin = req.header('X-Forwarded-For') ?? req.header('host');
            try {
                logger.stream().on('log', (log: LogInfo) => {
                    if (isLogLineMinLevel(log, level as string)) {
                        const {subreddit: subName, bot, user} = log;
                        let canAccess = false;
                        if(user !== undefined && user.includes(userName)) {
                            canAccess = true;
                        } else if(subName !== undefined || bot !== undefined) {
                            if(subName === undefined) {
                                canAccess = requestedBots.includes(bot);
                            } else {
                                canAccess = requestedManagers.includes(subName);
                            }
                        } else if(isOperator) {
                            canAccess = true;
                        }

                        if (canAccess) {
                            if(streamObjects) {
                                let obj: any = transformLog(log, {formatted, transports});
                                res.write(`${JSON.stringify(obj)}\r\n`);
                            } else if(formatted) {
                                res.write(`${log[MESSAGE]}\r\n`)
                            } else {
                                res.write(`${log.message}\r\n`)
                            }
                        }
                    }
                });
                logger.info(`${userName} from ${origin} => CONNECTED`);
                await pEvent(req, 'close');
                //logger.debug('Request closed detected with "close" listener');
                res.destroy();
                return;
            } catch (e: any) {
                if (e.code !== 'ECONNRESET') {
                    logger.error(e);
                }
            } finally {
                logger.info(`${userName} from ${origin} => DISCONNECTED`);
                res.destroy();
            }
        } else {

            const allReq = req.query.subreddit !== undefined && (req.query.subreddit as string).toLowerCase() === 'all';

            const botArr: any = [];
            for(const b of bots) {
                const managerLogs = new Map<string, LogInfo[]>();
                const managers = req.manager !== undefined ? [req.manager] : req.user?.accessibleSubreddits(b) as Manager[];
                for (const m of managers) {
                    const logs = filterLogs(m.logs, {
                        level: (level as string),
                        // @ts-ignore
                        sort,
                        limit: Number.parseInt((limit as string)),
                        returnType: 'object'
                    }) as LogInfo[];
                    managerLogs.set(m.getDisplay(), logs);
                }
                const allLogs = filterLogs([...[...managerLogs.values()].flat(), ...(req.user?.isInstanceOperator(req.botApp) ? b.logs : b.logs.filter(x => x.user === req.user?.name))], {
                    level: (level as string),
                    // @ts-ignore
                    sort,
                    limit: limit as string,
                    returnType: 'object'
                }) as LogInfo[];
                const systemLogs = filterLogs(req.user?.isInstanceOperator(req.botApp) ? b.logs : b.logs.filter(x => x.user === req.user?.name), {
                    level: (level as string),
                    // @ts-ignore
                    sort,
                    limit: limit as string,
                    returnType: 'object'
                }) as LogInfo[];
                botArr.push({
                    name: b.getBotName(),
                    system: systemLogs,
                    all: allLogs.map(x => transformLog(x, {formatted, transports })),
                    subreddits: allReq ? [] : [...managerLogs.entries()].reduce((acc: any[], curr) => {
                        const l = curr[1].map(x => transformLog(x, {formatted, transports }));
                        acc.push({name: curr[0], logs: l});
                        return acc;
                    }, [])
                });
            }
            return res.json(botArr);
        }
    };

    return [...middleware, response];
}

const transformLog = (obj: LogInfo, options: { formatted: boolean, transports: boolean }) => {
    const {
        [MESSAGE]: fMessage,
        transport,
        //@ts-ignore
        name, // name is the name of the last transport
        ...rest
    } = obj;
    const transformed: any = rest;
    if (options.formatted) {
        transformed.formatted = fMessage;
    }
    if (options.transports) {
        transformed.transport = transport;
        transformed.name = name;
    }
    return transformed;
}

export default logs;
