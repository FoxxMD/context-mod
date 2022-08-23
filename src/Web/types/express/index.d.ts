import {App} from "../../../App";
import Bot from "../../../Bot";
import {Manager} from "../../../Subreddit/Manager";
import CMUser from "../../Common/User/CMUser";
import {BotInstance, CMInstanceInterface} from "../../Common/interfaces";

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
