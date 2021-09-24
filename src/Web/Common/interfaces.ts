import {RunningState} from "../../Subreddit/Manager";
import {ManagerStats} from "../../Common/interfaces";

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
    logs: string[]
    botState: RunningState
    eventsState: RunningState
    queueState: RunningState
    indicator: string
    queuedActivities: number
    runningActivities: number
    maxWorkers: number
    subMaxWorkers: number
    globalMaxWorkers: number
    validConfig: string | boolean
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
