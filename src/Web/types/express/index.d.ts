import {App} from "../../../App";
import Bot from "../../../Bot";
import {BotInstance, CMInstance} from "../../interfaces";
import {Manager} from "../../../Subreddit/Manager";

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
        interface User {
            name: string
            subreddits: string[]
            machine?: boolean
            isOperator?: boolean
            realManagers?: string[]
            moderatedManagers?: string[]
            realBots?: string[]
            moderatedBots?: string[]
            scope?: string[]
        }
    }
}
