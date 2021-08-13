import {BotClient} from "./interfaces";
import {App} from "../../../App";

declare global {
    declare namespace Express {
        interface Request {
            botApp: App;
            token?: string,
            bot?: BotClient,
        }
    }
}
