import {BotStats, BotStatusResponse, SubredditDataResponse} from "./interfaces";
import {RunningState} from "../../Subreddit/Manager";
import {ManagerStats} from "../../Common/interfaces";
import {cacheStats } from "../../util";
import {createHistoricalDisplayDefaults} from "../../Common/defaults";
import {Invokee, RunState} from "../../Common/Infrastructure/Atomic";

const managerStats: ManagerStats = {
    cache: {
        currentKeyCount: 0,
        isShared: false,
        missPercent: "-",
        provider: "-",
        requestRate: 0,
        totalMiss: 0,
        totalRequests: 0,
        types: cacheStats()
    },
    historical: createHistoricalDisplayDefaults(),
    eventsAvg: 0,
    rulesAvg: 0,
};
const botStats: BotStats = {
    apiAvg: '-',
    apiDepletion: "-",
    apiLimit: 0,
    limitReset: '-',
    limitResetHuman: "-",
    nannyMode: "-",
    nextHeartbeat: "-",
    nextHeartbeatHuman: "-",
    startedAtHuman: "-"
};

const runningState: RunningState = {
    causedBy: '-' as Invokee,
    state: '-' as RunState,
}

const sub: SubredditDataResponse = {
    botState: runningState,
    checks: {comments: 0, submissions: 0},
    delayBy: "-",
    dryRun: false,
    eventsState: runningState,
    globalMaxWorkers: 0,
    hardLimit: 0,
    heartbeat: 0,
    heartbeatHuman: "-",
    indicator: "-",
    logs: [],
    guests: [],
    maxWorkers: 0,
    name: "-",
    pollingInfo: [],
    queueState: runningState,
    queuedActivities: 0,
    runningActivities: 0,
    delayedItems: [],
    softLimit: 0,
    startedAt: "-",
    startedAtHuman: "-",
    stats: managerStats,
    subMaxWorkers: 0,
    validConfig: false,
    configFormat: 'yaml',
    wikiHref: "-",
    wikiLastCheck: "-",
    wikiLastCheckHuman: "-",
    wikiLocation: "-",
    wikiRevision: "-",
    wikiRevisionHuman: "-",
    retention: 'Unknown'
};

export const defaultBotStatus = (subreddits: string[] = []) => {

    const subs: SubredditDataResponse[] = [
        {
          ...sub,
          name: 'All',
        },
        ...subreddits.map(x => ({...sub, name: x}))
    ];

    const data: BotStatusResponse = {
        subreddits: subs,
        system: {
            startedAt: '-',
            running: false,
            account: '-',
            name: '-',
            ...botStats,
        }
    };
    return data;
}
