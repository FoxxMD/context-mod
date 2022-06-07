import { URL } from "url";
import {BotConnection} from "../Common/interfaces";
import {Logger} from "winston";

export interface BotInstance {
    botName: string
    botLink: string
    error?: string
    subreddits: string[]
    nanny?: string
    running: boolean
    instance: CMInstanceInterface
}

export interface CMInstanceInterface extends BotConnection {
    friendly?: string
    operators: string[]
    operatorDisplay: string
    url: URL,
    normalUrl: string,
    lastCheck?: number
    online: boolean
    subreddits: string[]
    bots: BotInstance[]
    error?: string
    ranMigrations: boolean
    migrationBlocker?: string
}
