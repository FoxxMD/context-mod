import {App} from "../../../App";
import Bot from "../../../Bot";
import {BotInstance, CMInstance} from "../../interfaces";
import {Manager} from "../../../Subreddit/Manager";
import CMUser from "../../Common/User/CMUser";

declare global {
    declare namespace Express {
        interface Request {
            botApp: App;
            token?: string,
            instance?: CMInstance,
            bot?: BotInstance,
            serverBot: Bot,
            manager?: Manager,
        }
        class User extends CMUser<any, any, any> {
        }
    }
}
