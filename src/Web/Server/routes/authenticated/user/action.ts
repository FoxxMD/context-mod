import {Request, Response} from 'express';
import {RUNNING, USER} from "../../../../../Common/interfaces";
import Submission from "snoowrap/dist/objects/Submission";
import LoggedError from "../../../../../Utils/LoggedError";
import {authUserCheck, botRoute} from "../../../middleware";
import {booleanMiddle} from "../../../../Common/middleware";
import {Manager} from "../../../../../Subreddit/Manager";
import {parseRedditEntity} from "../../../../../util";

const action = async (req: Request, res: Response) => {
    const bot = req.serverBot;

    const {type, action, subreddit, force = false} = req.query as any;
    const userName = req.user?.name;
    let subreddits: Manager[] = req.user?.accessibleSubreddits(bot) as Manager[];
    if (subreddit !== 'All') {
        subreddits = subreddits.filter(x => x.subreddit.display_name === parseRedditEntity(subreddit).name);
    }

    for (const manager of subreddits) {
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
                            await manager.firehose.push({
                                checkType: a instanceof Submission ? 'Submission' : 'Comment',
                                activity: a,
                                options: {
                                    force: true,
                                }
                            });
                        }
                    } else {
                        const activities = await manager.subreddit.getModqueue({limit: 100});
                        for (const a of activities.reverse()) {
                            await manager.firehose.push({
                                checkType: a instanceof Submission ? 'Submission' : 'Comment',
                                activity: a,
                                options: {
                                    force: true
                                }
                            });
                        }
                    }
                    break;
            }
        } catch (err: any) {
            if (!(err instanceof LoggedError)) {
                mLogger.error(err, {subreddit: manager.displayLabel});
            }
        }
    }
    res.send('OK');
};

const actionRoute = [authUserCheck(), botRoute(), booleanMiddle(['force']), action];
export default actionRoute;
