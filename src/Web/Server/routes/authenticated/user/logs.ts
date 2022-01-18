import {Router} from '@awaitjs/express';
import {Request, Response} from 'express';
import {filterLogBySubreddit, isLogLineMinLevel, LogEntry, parseSubredditLogName} from "../../../../../util";
import {Transform} from "stream";
import winston from "winston";
import pEvent from "p-event";
import {getLogger} from "../../../../../Utils/loggerFactory";
import {booleanMiddle} from "../../../../Common/middleware";
import {authUserCheck, botRoute} from "../../../middleware";
import {LogInfo} from "../../../../../Common/interfaces";
import {MESSAGE} from "triple-beam";

// TODO update logs api
const logs = (subLogMap: Map<string, LogEntry[]>) => {
    const middleware = [
        authUserCheck(),
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
                        const {subreddit: subName} = log;
                        if (isOperator || (subName !== undefined && (realManagers.includes(subName) || subName.includes(userName)))) {
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
                console.log('Request closed detected with "close" listener');
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
            const logs = filterLogBySubreddit(subLogMap, realManagers, {
                level: (level as string),
                operator: isOperator,
                user: userName,
                sort: sort as 'descending' | 'ascending',
                limit: Number.parseInt((limit as string)),
                returnType: 'object',
            });
            const subArr: any = [];
            logs.forEach((v: (string|LogInfo)[], k: string) => {
                let logs = v as LogInfo[];
                let output: any[] = formatted ? logs : logs.map((x) => {
                    const {[MESSAGE]: fMessage, ...rest} = x;
                    return rest;
                })
                subArr.push({name: k, logs: output});
            });
            return res.json(subArr);
        }
    };

    return [...middleware, response];
}

export default logs;
