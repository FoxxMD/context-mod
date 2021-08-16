import {BotStats, BotStatusResponse, SubredditDataResponse} from "./interfaces";
import {ManagerStats, RunningState} from "../../Subreddit/Manager";
import {Invokee, RunState} from "../../Common/interfaces";
import {cacheStats} from "../../util";

const managerStats: ManagerStats = {
    actionsRun: 0,
    actionsRunSinceStart: 0,
    actionsRunSinceStartTotal: 0,
    actionsRunTotal: 0,
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
    checksRunSinceStartTotal: 0,
    checksRunTotal: 0,
    checksTriggered: 0,
    checksTriggeredSinceStart: 0,
    checksTriggeredSinceStartTotal: 0,
    checksTriggeredTotal: 0,
    eventsAvg: 0,
    eventsCheckedSinceStartTotal: 0,
    eventsCheckedTotal: 0,
    rulesAvg: 0,
    rulesCachedSinceStartTotal: 0,
    rulesCachedTotal: 0,
    rulesRunSinceStartTotal: 0,
    rulesRunTotal: 0,
    rulesTriggeredSinceStartTotal: 0,
    rulesTriggeredTotal: 0
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
