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
        }])
    ];

    const response = async (req: Request, res: Response) => {

        const logger = winston.loggers.get('app');

        const userName = req.user?.name as string;
        const isOperator = req.user?.isInstanceOperator(req.botApp);
        const realManagers = req.botApp.bots.map(x => req.user?.accessibleSubreddits(x).map(x => x.displayLabel)).flat() as string[];
        const {level = 'verbose', stream, limit = 200, sort = 'descending', streamObjects = false, formatted = true} = req.query;
        if (stream) {
            const origin = req.header('X-Forwarded-For') ?? req.header('host');
            try {
                logger.stream().on('log', (log: LogInfo) => {
                    if (isLogLineMinLevel(log, level as string)) {
                        const {subreddit: subName, user} = log;
                        if (isOperator || (subName !== undefined && (realManagers.includes(subName) || (user !== undefined && user.includes(userName))))) {
                            if(streamObjects) {
                                let obj: any = log;
                                if(!formatted) {
                                    const {[MESSAGE]: fMessage, ...rest} = log;
                                    obj = rest;
                                }
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
            let bots: Bot[] = [];
            if(req.serverBot !== undefined) {
                bots = [req.serverBot];
            } else {
                bots = req.user?.accessibleBots(req.botApp.bots) as Bot[];
            }

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
                    all: formatted ? allLogs.map(x => {
                        const {[MESSAGE]: fMessage, ...rest} = x;
                        return {...rest, formatted: fMessage};
                    }) : allLogs,
                    subreddits: allReq ? [] : [...managerLogs.entries()].reduce((acc: any[], curr) => {
                        const l = formatted ? curr[1].map(x => {
                            const {[MESSAGE]: fMessage, ...rest} = x;
                            return {...rest, formatted: fMessage};
                            }) : curr[1];
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

export default logs;
