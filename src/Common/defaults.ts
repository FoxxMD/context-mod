import {FilterCriteriaDefaults, HistoricalStatsDisplay} from "./interfaces";
import path from "path";

export const cacheOptDefaults = {ttl: 60, max: 500, checkPeriod: 600};
export const cacheTTLDefaults = {authorTTL: 60, userNotesTTL: 300, wikiTTL: 300, submissionTTL: 60, commentTTL: 60, filterCriteriaTTL: 60, subredditTTL: 600, selfTTL: 60};

export const createHistoricalDisplayDefaults = (): HistoricalStatsDisplay => ({
    checksRunTotal: 0,
    checksFromCacheTotal: 0,
    checksTriggeredTotal: 0,
    rulesRunTotal: 0,
    rulesCachedTotal: 0,
    rulesTriggeredTotal: 0,
    actionsRunTotal: 0,
    eventsCheckedTotal: 0,
    eventsActionedTotal: 0,
})

export const filterCriteriaDefault: FilterCriteriaDefaults = {
    authorIs: {
        exclude: [
            {
                isMod: true
            }
        ]
    }
}

export const defaultDataDir = path.resolve(__dirname, '../..');
export const defaultConfigFilenames = ['config.yaml', 'config.json'];

export const VERSION = '0.10.12';
