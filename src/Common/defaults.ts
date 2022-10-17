import {HistoricalStatsDisplay} from "./interfaces";
import path from "path";
import {FilterCriteriaDefaults} from "./Infrastructure/Filters/FilterShapes";

export const dayjsDTFormat = 'YYYY-MM-DD HH:mm:ssZ';
export const dayjsTimeFormat = 'HH:mm:ss z';

export const cacheOptDefaults = {ttl: 60, max: 500, checkPeriod: 600};
export const cacheTTLDefaults = {
    authorTTL: 60,
    userNotesTTL: 300,
    modNotesTTL: 60,
    wikiTTL: 300,
    submissionTTL: 60,
    commentTTL: 60,
    filterCriteriaTTL: 60,
    subredditTTL: 600,
    selfTTL: 60
};

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
                criteria: {
                    isMod: true
                }
            }
        ]
    }
}

export const defaultDataDir = path.resolve(__dirname, '../..');
export const defaultConfigFilenames = ['config.json', 'config.yaml'];

export const VERSION = '0.13.2';
