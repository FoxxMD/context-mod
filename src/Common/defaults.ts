import {HistoricalStats} from "./interfaces";

export const cacheOptDefaults = {ttl: 60, max: 500, checkPeriod: 600};
export const cacheTTLDefaults = {authorTTL: 60, userNotesTTL: 300, wikiTTL: 300, submissionTTL: 60, commentTTL: 60, filterCriteriaTTL: 60, subredditTTL: 600};
export const historicalDefaults: HistoricalStats = {
    eventsCheckedTotal: 0,
    eventsActionedTotal: 0,
    checksRun: new Map(),
    checksFromCache: new Map(),
    checksTriggered: new Map(),
    rulesRun: new Map(),
    //rulesCached: new Map(),
    rulesCachedTotal: 0,
    rulesTriggered: new Map(),
    actionsRun: new Map(),
}

export const createHistoricalDefaults = (): HistoricalStats => {
    return {
        eventsCheckedTotal: 0,
        eventsActionedTotal: 0,
        checksRun: new Map(),
        checksFromCache: new Map(),
        checksTriggered: new Map(),
        rulesRun: new Map(),
        //rulesCached: new Map(),
        rulesCachedTotal: 0,
        rulesTriggered: new Map(),
        actionsRun: new Map(),
    };
}
