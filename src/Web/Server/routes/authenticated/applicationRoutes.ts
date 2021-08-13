import {Router} from '@awaitjs/express';
import {Request, Response} from 'express';
import {authUserCheck} from "../../middleware";

const router = Router();
router.use(authUserCheck(false));

interface OperatorData {
    name: string[]
    display?: string
}

export const heartbeat = (opData: OperatorData) => {
    const response = async (req: Request, res: Response) => {
        const heartbeatData = {
            subreddits: req.botApp.subManagers.map(x => x.subreddit.display_name),
            operators: opData.name,
            operatorDisplay: opData.display,
            friendly: req.botApp !== undefined ? req.botApp.botName : undefined,
            running: req.botApp !== undefined ? req.botApp.heartBeating : false,
            nanny: req.botApp !== undefined ? req.botApp.nannyMode : undefined,
            botName: req.botApp !== undefined ? req.botApp.botName : undefined,
            botLink: req.botApp !== undefined ? req.botApp.botLink : undefined,
            error: req.botApp.error,
        };
        return res.json(heartbeatData);
    };
    return [authUserCheck(false), response];
}
