import {Request, Response} from 'express';
import {BotInstanceConfig} from "../../../../../Common/interfaces";
import {authUserCheck} from "../../../middleware";
import Bot from "../../../../../Bot";
import LoggedError from "../../../../../Utils/LoggedError";

const addBot = () => {

    const middleware = [
        authUserCheck(),
    ];

    const response = async (req: Request, res: Response) => {

        if (!(req.user as Express.User).isOperator) {
            return res.status(401).send("Must be an Operator to use this route");
        }

        const newBot = new Bot(req.body as BotInstanceConfig, req.botApp.logger);
        req.botApp.bots.push(newBot);
        let result: any = {stored: true};
        try {
            if (newBot.error !== undefined) {
                result.error = newBot.error;
                return res.status(500).json(result);
            }
            await newBot.testClient();
            await newBot.buildManagers();
            newBot.runManagers('user').catch((err) => {
                req.botApp.logger.error(`Unexpected error occurred while running Bot ${newBot.botName}. Bot must be re-built to restart`);
                if (!err.logged || !(err instanceof LoggedError)) {
                    req.botApp.logger.error(err);
                }
            });
        } catch (err: any) {
            if (newBot.error === undefined) {
                newBot.error = err.message;
                result.error = err.message;
            }
            req.botApp.logger.error(`Bot ${newBot.botName} cannot recover from this error and must be re-built`);
            if (!err.logged || !(err instanceof LoggedError)) {
                req.botApp.logger.error(err);
            }
        }
        return res.json(result);
    }
    return [...middleware, response];
}

export default addBot;
