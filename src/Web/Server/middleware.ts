import {Request, Response, NextFunction} from "express";
import Bot from "../../Bot";
import ServerUser from "../Common/User/ServerUser";

export type AuthEntityType = 'user' | 'operator' | 'machine';

export const authUserCheck = (allowedEntityTypes: AuthEntityType | AuthEntityType[] = ['user']) => async (req: Request, res: Response, next: Function) => {
    const types = Array.isArray(allowedEntityTypes) ? allowedEntityTypes : [allowedEntityTypes];

    if (req.isAuthenticated()) {
        if(types.length === 0) {
            return next();
        }
        if(types.includes('machine') && (req.user as ServerUser).machine) {
            return next();
        }
        if(types.includes('operator') && req.user.isInstanceOperator(req.botApp)) {
            return next();
        }
        if(types.includes('user') && !(req.user as ServerUser).machine) {
            return next();
        }
        req.logger.error(`User is authenticated but does not sufficient permissions. Required: ${types.join(', ')} | User: ${req.user.name}`);
        return res.status(403).send('Must be authenticated to access this route');
    } else {
        return res.status(401).send('Must be authenticated to access this route');
    }
}

export const botRoute = (required = true) => async (req: Request, res: Response, next: Function) => {
    const {bot: botVal} = req.query;
    if (botVal === undefined) {
        if(required) {
            return res.status(400).send("Must specify 'bot' parameter");
        }
        return next();
    }
    const botStr = botVal as string;

    if(req.user !== undefined) {
        const serverBot = req.botApp.bots.find(x => x.botName === botStr) as Bot;

        if(serverBot === undefined) {
            return res.status(404).send(`Bot named ${botStr} does not exist or you do not have permission to access it.`);
        }
        if (!req.user?.canAccessBot(serverBot)) {
            return res.status(404).send(`Bot named ${botStr} does not exist or you do not have permission to access it.`);
        }
        req.serverBot = serverBot;
        return next();
    }
    return next();
}

export const subredditRoute = (required = true, modRequired = false, guestRequired = false) => async (req: Request, res: Response, next: Function) => {

    const bot = req.serverBot;

    const {subreddit} = req.query as any;
    if(subreddit === undefined && !required) {
        next();
    } else {

        if(subreddit.toLowerCase() === 'all') {
            next();
        } else {
            //const {name: userName} = req.user as Express.User;

            const manager = bot.subManagers.find(x => x.displayLabel === subreddit);
            if (manager === undefined) {
                return res.status(400).send('Cannot access route for subreddit you do not manage or is not run by the bot')
            }

            if (!req.user?.canAccessSubreddit(bot, subreddit) || (modRequired && !req.user?.isSubredditMod(bot, subreddit)) || (guestRequired && !req.user?.isSubredditGuest(bot, subreddit))) {
                return res.status(400).send('Cannot access route for subreddit you do not manage or is not run by the bot')
            }

            req.manager = manager;

            next();
        }
    }
}
