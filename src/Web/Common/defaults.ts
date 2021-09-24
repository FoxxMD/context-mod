import {BotStats, BotStatusResponse, SubredditDataResponse} from "./interfaces";
import {RunningState} from "../../Subreddit/Manager";
import {Invokee, ManagerStats, RunState} from "../../Common/interfaces";
import {cacheStats, createHistoricalStatsDisplay} from "../../util";
import {historicalDefaults} from "../../Common/defaults";

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
    historical: {
        lastReload: createHistoricalStatsDisplay(historicalDefaults),
        allTime: createHistoricalStatsDisplay(historicalDefaults),
    },
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
    maxWorkers: 0,
    name: "-",
    pollingInfo: [],
    queueState: runningState,
    queuedActivities: 0,
    runningActivities: 0,
    softLimit: 0,
    startedAt: "-",
    startedAtHuman: "-",
    stats: managerStats,
    subMaxWorkers: 0,
    validConfig: false,
    wikiHref: "-",
    wikiLastCheck: "-",
    wikiLastCheckHuman: "-",
    wikiLocation: "-",
    wikiRevision: "-",
    wikiRevisionHuman: "-"
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
