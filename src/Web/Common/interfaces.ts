import {RunningState} from "../../Subreddit/Manager";
import {BotConnection, LogInfo, ManagerStats} from "../../Common/interfaces";
import {Guest, GuestAll} from "../../Common/Entities/Guest/GuestInterfaces";
import {URL} from "url";
import {Dayjs} from "dayjs";

export interface BotStats {
    startedAtHuman: string,
    nextHeartbeat: string,
    nextHeartbeatHuman: string,
    apiLimit: number,
    apiAvg: string | number,
    nannyMode: string,
    apiDepletion: string,
    limitReset: string | number,
    limitResetHuman: string
}

export interface SubredditDataResponse {
    name: string
    logs: (string|LogInfo)[]
    botState: RunningState
    eventsState: RunningState
    queueState: RunningState
    indicator: string
    queuedActivities: number
    runningActivities: number
    delayedItems: any[]
    maxWorkers: number
    subMaxWorkers: number
    globalMaxWorkers: number
    validConfig: string | boolean
    configFormat: 'yaml' | 'json'
    dryRun: string | boolean
    pollingInfo: string[]
    checks: {
        submissions: number
        comments: number
    }
    wikiLocation: string
    wikiHref: string
    wikiRevisionHuman: string
    wikiRevision: string
    wikiLastCheckHuman: string
    wikiLastCheck: string
    stats: ManagerStats
    startedAt: string
    startedAtHuman: string
    delayBy: string
    softLimit?: number
    hardLimit?: number
    heartbeatHuman?: string
    heartbeat: number
    retention: string
    guests: (Guest | GuestAll)[]
}

export interface BotStatusResponse {
    system: BotStats & {
        startedAt: string,
        name: string,
        running: boolean,
        error?: string,
        account: string,
    }
    subreddits: SubredditDataResponse[]
}

export interface IUser {
    name: string
    subreddits: string[]
    machine?: boolean
    isOperator?: boolean
    realManagers?: string[]
    moderatedManagers?: string[]
    realBots?: string[]
    moderatedBots?: string[]
    scope?: string[]
    token?: string
    tokenExpiresAt?: number
}

export interface ManagerResponse {
    name: string,
    subreddit: string,
    guests: Guest[]
}

export interface NormalizedManagerResponse extends ManagerResponse {
    subredditNormal: string
}


export interface BotInstanceResponse {
    botName: string
    //botLink: string
    error?: string
    managers: ManagerResponse[]
    nanny?: string
    running: boolean
}

export interface BotInstanceFunctions {
    getSubreddits: (normalized?: boolean) => string[]
    getAccessibleSubreddits: (user: string, subreddits: string[]) => string[]
    getManagerNames: () => string[]
    getGuestManagers: (user: string) => NormalizedManagerResponse[]
    getGuestSubreddits: (user: string) => string[]
    canUserAccessBot: (user: string, subreddits: string[]) => boolean
    canUserAccessSubreddit: (subreddit: string, user: string, subreddits: string[]) => boolean
}

export interface BotInstance extends BotInstanceResponse, BotInstanceFunctions {
    managers: NormalizedManagerResponse[]
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
    invites: string[]
}

export interface HeartbeatResponse {
    ranMigrations: boolean
    migrationBlocker?: string
    operators: string[]
    operatorDisplay?: string
    friendly?: string
    bots: BotInstanceResponse[]
    invites: string[]
}


export interface InviteData {
    permissions: string[],
    subreddits?: string[],
    instance?: string,
    clientId: string
    clientSecret: string
    redirectUri: string
    creator: string
    overwrite?: boolean
    initialConfig?: string
    expiresAt?: number | Dayjs
    guests?: string[]
}

export interface SubredditInviteData {
    subreddit: string
    guests?: string[]
    initialConfig?: string
    expiresAt?: number | Dayjs
}
