import {Router} from '@awaitjs/express';
import {Request, Response} from 'express';
import {authUserCheck} from "../../middleware";

const router = Router();
router.use(authUserCheck(false));

interface OperatorData {
    name: string[]
    display?: string
    friendly?: string
}

export const heartbeat = (opData: OperatorData) => {
    const response = async (req: Request, res: Response) => {
        if(req.botApp === undefined) {
            return res.status(500).send('Application is initializing, try again in a few seconds');
        }
        const heartbeatData = {
            subreddits: req.botApp.bots.map(y => y.subManagers.map(x => x.subreddit.display_name)).flat(),
            bots: req.botApp.bots.map(x => ({botName: x.botName, subreddits: x.subManagers.map(y => y.displayLabel), running: x.running})),
            operators: opData.name,
            operatorDisplay: opData.display,
            friendly: opData.friendly,
            //friendly: req.botApp !== undefined ? req.botApp.botName : undefined,
            //running: req.botApp !== undefined ? req.botApp.heartBeating : false,
            //nanny: req.botApp !== undefined ? req.botApp.nannyMode : undefined,
            //botName: req.botApp !== undefined ? req.botApp.botName : undefined,
            //botLink: req.botApp !== undefined ? req.botApp.botLink : undefined,
            //error: req.botApp.error,
        };
        return res.json(heartbeatData);
    };
    return [authUserCheck(false), response];
}
