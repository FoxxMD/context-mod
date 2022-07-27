import {App} from "../../../App";
import Bot from "../../../Bot";
import {BotInstance, CMInstanceInterface} from "../../interfaces";
import {Manager} from "../../../Subreddit/Manager";
import CMUser from "../../Common/User/CMUser";

declare global {
    declare namespace Express {
        interface Request {
            botApp: App;
            logger: Logger;
            token?: string,
            instance?: CMInstanceInterface,
            bot?: BotInstance,
            serverBot: Bot,
            manager?: Manager,
        }
        class User extends CMUser<any, any, any> {
        }
    }
}
