import {Router} from '@awaitjs/express';
import {Request, Response} from 'express';
import {authUserCheck} from "../../middleware";
import {HeartbeatResponse} from "../../../Common/interfaces";
import {guestEntityToApiGuest} from "../../../../Common/Entities/Guest/GuestEntity";

/*const router = Router();
router.use(authUserCheck(['machine']));*/

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
        //req.botApp.migrationBlocker
        const heartbeatData: HeartbeatResponse = {
            //subreddits: req.botApp.bots.map(y => y.subManagers.map(x => x.subreddit.display_name)).flat(),
            bots: req.botApp.bots.map(x => ({
                botName: x.botName as string,
                managers: x.subManagers.map(y => ({
                    name: y.displayLabel,
                    subreddit: y.subreddit.display_name,
                    guests: y.managerEntity.getGuests().map(x => guestEntityToApiGuest(x)),
                })),
                running: x.running,
            })),
            operators: opData.name,
            operatorDisplay: opData.display,
            friendly: req.botApp.friendly,
            ranMigrations: req.botApp.ranMigrations,
            migrationBlocker: req.botApp.migrationBlocker,
            invites: await req.botApp.getInviteIds()
        };
        return res.json(heartbeatData);
    };
    return [authUserCheck(['machine']), response];
}
