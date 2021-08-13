import express, {Request, Response} from 'express';
import {RUNNING, USER} from "../../../../../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import LoggedError from "../../../../../Utils/LoggedError";
import winston from "winston";
import {authUserCheck} from "../../../middleware";
import {booleanMiddle} from "../../../../Common/middleware";

const action = async (req: express.Request, res: express.Response) => {
    const bot = req.botApp;

    const {type, action, subreddit, force = false} = req.query as any;
    const {name: userName, realManagers = [], isOperator} = req.user as Express.User;
    let subreddits: string[] = [];
    if (subreddit === 'All') {
        subreddits = realManagers;
    } else if (realManagers.includes(subreddit)) {
        subreddits = [subreddit];
    }

    for (const s of subreddits) {
        const manager = bot.subManagers.find(x => x.displayLabel === s);
        if (manager === undefined) {
            winston.loggers.get('default').warn(`Manager for ${s} does not exist`, {subreddit: `/u/${userName}`});
            continue;
        }
        const mLogger = manager.logger;
        mLogger.info(`/u/${userName} invoked '${action}' action for ${type} on ${manager.displayLabel}`);
        try {
            switch (action) {
                case 'start':
                    if (type === 'bot') {
                        await manager.start('user');
                    } else if (type === 'queue') {
                        manager.startQueue('user');
                    } else {
                        await manager.startEvents('user');
                    }
                    break;
                case 'stop':
                    if (type === 'bot') {
                        await manager.stop('user');
                    } else if (type === 'queue') {
                        await manager.stopQueue('user');
                    } else {
                        manager.stopEvents('user');
                    }
                    break;
                case 'pause':
                    if (type === 'queue') {
                        await manager.pauseQueue('user');
                    } else {
                        manager.pauseEvents('user');
                    }
                    break;
                case 'reload':
                    const prevQueueState = manager.queueState.state;
                    const newConfig = await manager.parseConfiguration('user', force);
                    if (newConfig === false) {
                        mLogger.info('Config was up-to-date');
                    }
                    if (newConfig && prevQueueState === RUNNING) {
                        await manager.startQueue(USER);
                    }
                    break;
                case 'check':
                    if (type === 'unmoderated') {
                        const activities = await manager.subreddit.getUnmoderated({limit: 100});
                        for (const a of activities.reverse()) {
                            await manager.queue.push({
                                checkType: a instanceof Submission ? 'Submission' : 'Comment',
                                activity: a,
                            });
                        }
                    } else {
                        const activities = await manager.subreddit.getModqueue({limit: 100});
                        for (const a of activities.reverse()) {
                            await manager.queue.push({
                                checkType: a instanceof Submission ? 'Submission' : 'Comment',
                                activity: a,
                            });
                        }
                    }
                    break;
            }
        } catch (err) {
            if (!(err instanceof LoggedError)) {
                mLogger.error(err, {subreddit: manager.displayLabel});
            }
        }
    }
    res.send('OK');
};

const actionRoute = [authUserCheck(), booleanMiddle(['force']), action];
export default actionRoute;
