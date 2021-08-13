import { URL } from "url";
import {BotConnection} from "../Common/interfaces";

export interface BotClient extends BotConnection {
    friendly: string
    botName: string
    botLink: string
    online: boolean
    indicator: string
    lastCheck: number
    error?: string
    subreddits: string[]
    operators: string[]
    operatorDisplay: string
    nanny?: string
    running: boolean
    url: URL,
    normalUrl: string,
}
