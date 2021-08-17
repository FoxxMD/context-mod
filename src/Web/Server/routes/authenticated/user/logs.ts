import {Router} from '@awaitjs/express';
import {Request, Response} from 'express';
import {filterLogBySubreddit, isLogLineMinLevel, LogEntry, parseSubredditLogName} from "../../../../../util";
import {Transform} from "stream";
import winston from "winston";
import pEvent from "p-event";
import {getLogger} from "../../../../../Utils/loggerFactory";
import {booleanMiddle} from "../../../../Common/middleware";
import {authUserCheck, botRoute} from "../../../middleware";

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

        const logger = winston.loggers.get('default');

        const {name: userName, realManagers = [], isOperator} = req.user as Express.User;
        const {level = 'verbose', stream, limit = 200, sort = 'descending'} = req.query;
        if (stream) {
            const userStream = new Transform({
                transform(chunk, encoding, callback) {
                    const log = chunk.toString().slice(0, -1);
                    if (isLogLineMinLevel(log, level as string)) {
                        const subName = parseSubredditLogName(log);
                        if (isOperator || (subName !== undefined && (realManagers.includes(subName) || subName.includes(userName)))) {
                            callback(null, `${log}\r\n`);
                        } else {
                            callback(null);
                        }
                    } else {
                        callback(null);
                    }
                }
            });
            userStream.on('end', () => {
                console.log('user end');
            });

            const currTransport = new winston.transports.Stream({
                stream: userStream,
            });
            logger.add(currTransport);
            const origin = req.header('X-Forwarded-For') ?? req.header('host');
            try {
                //winstonStream.pipe(userStream, {end: false});
                //logStream.pipe(userStream, {end: false});
                logger.info(`${userName} from ${origin} => CONNECTED`);
                userStream.pipe(res, {end: false});
                await pEvent(req, 'close');
                console.log('Request closed detected with "close" listener');
                userStream.end();
                res.destroy();
                return;
            } catch (e) {
                if (e.code !== 'ECONNRESET') {
                    logger.error(e);
                }
            } finally {
                logger.info(`${userName} from ${origin} => DISCONNECTED`);
                logger.remove(currTransport);
                userStream.end();
                res.destroy();
            }
        } else {
            const logs = filterLogBySubreddit(subLogMap, realManagers, {
                level: (level as string),
                operator: isOperator,
                user: userName,
                sort: sort as 'descending' | 'ascending',
                limit: Number.parseInt((limit as string))
            });
            const subArr: any = [];
            logs.forEach((v: string[], k: string) => {
                subArr.push({name: k, logs: v.join('')});
            });
            return res.json(subArr);
        }
    };

    return [...middleware, response];
}

export default logs;
