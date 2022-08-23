import {authUserCheck, botRoute} from "../../../middleware";
import {Request, Response} from "express";
import {CMError} from "../../../../../Utils/Errors";

const getSubredditInvites = async (req: Request, res: Response) => {

    return res.json(await req.serverBot.cacheManager.getPendingSubredditInvites());
};
export const getSubredditInvitesRoute = [authUserCheck(), botRoute(), getSubredditInvites];
const addSubredditInvite = async (req: Request, res: Response) => {

    const {subreddit} = req.body as any;
    if (subreddit === undefined || subreddit === null || subreddit === '') {
        return res.status(400).send('subreddit must be defined');
    }
    try {
        await req.serverBot.cacheManager.addPendingSubredditInvite(subreddit);
    } catch (e: any) {
        if (e instanceof CMError) {
            req.logger.warn(e);
            return res.status(400).send(e.message);
        } else {
            req.logger.error(e);
            return res.status(500).send(e.message);
        }
    }
    return res.status(200).send();
};
export const addSubredditInviteRoute = [authUserCheck(), botRoute(), addSubredditInvite];
const deleteSubredditInvite = async (req: Request, res: Response) => {

    const {subreddit} = req.query as any;
    if (subreddit === undefined || subreddit === null || subreddit === '') {
        return res.status(400).send('subreddit must be defined');
    }
    await req.serverBot.cacheManager.deletePendingSubredditInvite(subreddit);
    return res.status(200).send();
};
export const deleteSubredditInviteRoute = [authUserCheck(), botRoute(), deleteSubredditInvite];

const getBotInvite = async (req: Request, res: Response) => {
    const invite = await req.botApp.getInviteById(req.params.id as any);
    if(invite === undefined) {
        return res.status(404).send(`Invite with ID ${req.params.id} does not exist`);
    }
    return res.json(invite);
}
export const getBotInviteRoute = [authUserCheck(['machine']), getBotInvite];

const addBotInvite = async (req: Request, res: Response) => {
    const invite = await req.botApp.addInvite(req.body);
    return res.json(invite);
}
export const addBotInviteRoute = [authUserCheck(['operator']), addBotInvite];
