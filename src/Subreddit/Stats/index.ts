import {Between, DataSource, Repository} from "typeorm";
import {TotalStat} from "../../Common/Entities/Stats/TotalStat";
import {TimeSeriesStat} from "../../Common/Entities/Stats/TimeSeriesStat";
import {statFrequencies, StatisticFrequencyOption} from "../../Common/Infrastructure/Atomic";
import {ManagerEntity} from "../../Common/Entities/ManagerEntity";
import {HistoricalStatsDisplay, ResourceStats} from "../../Common/interfaces";
import {createHistoricalDisplayDefaults} from "../../Common/defaults";
import dayjs from "dayjs";
import {ErrorWithCause} from "pony-cause";
import {cacheStats, formatNumber, frequencyEqualOrLargerThanMin, mergeArr} from "../../util";
import {Cache} from "cache-manager";
import winston, {Logger} from "winston";
import {CMCache} from "../../Common/Cache";

export class SubredditStats {
    totalStatsRepo: Repository<TotalStat>
    totalStatsEntities?: TotalStat[];
    tsStatsRepo: Repository<TimeSeriesStat>
    timeSeriesStatsEntities?: TimeSeriesStat[];
    statFrequency: StatisticFrequencyOption
    historicalSaveInterval?: any;
    managerEntity: ManagerEntity;
    cache: CMCache;
    protected logger: Logger;
    init: boolean = false;

    stats: {
        cache: ResourceStats
        historical: HistoricalStatsDisplay
        timeSeries: HistoricalStatsDisplay
    };

    constructor(database: DataSource, managerEntity: ManagerEntity, cache: CMCache, statFrequency: StatisticFrequencyOption, logger: Logger) {
        this.totalStatsRepo = database.getRepository(TotalStat);
        this.tsStatsRepo = database.getRepository(TimeSeriesStat);
        this.statFrequency = statFrequency;
        this.managerEntity = managerEntity;
        this.cache = cache;
        if (logger === undefined) {
            const alogger = winston.loggers.get('app')
            this.logger = alogger.child({labels: [this.managerEntity.name, 'Stats']}, mergeArr);
        } else {
            this.logger = logger.child({labels: ['Stats']}, mergeArr);
        }

        this.stats = {
            cache: cacheStats(),
            historical: createHistoricalDisplayDefaults(),
            timeSeries: createHistoricalDisplayDefaults(),
        };
    }

    async initStats(force: boolean = false) {
        if (!this.init || force) {
            try {
                let currentStats: HistoricalStatsDisplay = createHistoricalDisplayDefaults();
                const totalStats = await this.totalStatsRepo.findBy({managerId: this.managerEntity.id});
                if (totalStats.length === 0) {
                    const now = dayjs();
                    const statEntities: TotalStat[] = [];
                    for (const [k, v] of Object.entries(currentStats)) {
                        statEntities.push(new TotalStat({
                            metric: k,
                            value: v,
                            manager: this.managerEntity,
                            createdAt: now,
                        }));
                    }
                    await this.totalStatsRepo.save(statEntities);
                    this.totalStatsEntities = statEntities;
                } else {
                    this.totalStatsEntities = totalStats;
                    for (const [k, v] of Object.entries(currentStats)) {
                        const matchedStat = totalStats.find(x => x.metric === k);
                        if (matchedStat !== undefined) {
                            currentStats[k] = matchedStat.value;
                        } else {
                            this.logger.warn(`Could not find historical stat matching '${k}' in the database, will default to 0`);
                            currentStats[k] = v;
                        }
                    }
                }
                this.stats.historical = currentStats;
            } catch (e) {
                this.logger.error(new ErrorWithCause('Failed to init historical stats', {cause: e}));
            }

            try {
                if (this.statFrequency !== false) {
                    let currentStats: HistoricalStatsDisplay = createHistoricalDisplayDefaults();
                    let startRange = dayjs().set('second', 0);
                    for (const unit of statFrequencies) {
                        if (unit !== 'week' && !frequencyEqualOrLargerThanMin(unit, this.statFrequency)) {
                            startRange = startRange.set(unit, 0);
                        }
                        if (unit === 'week' && this.statFrequency === 'week') {
                            // make sure we get beginning of week
                            startRange = startRange.week(startRange.week());
                        }
                    }
                    // set end range by +1 of whatever unit we are using
                    const endRange = this.statFrequency === 'week' ? startRange.clone().week(startRange.week() + 1) : startRange.clone().set(this.statFrequency, startRange.get(this.statFrequency) + 1);

                    const tsStats = await this.tsStatsRepo.findBy({
                        managerId: this.managerEntity.id,
                        granularity: this.statFrequency,
                        // make sure its inclusive!
                        _createdAt: Between(startRange.clone().subtract(1, 'second').toDate(), endRange.clone().add(1, 'second').toDate())
                    });

                    if (tsStats.length === 0) {
                        const statEntities: TimeSeriesStat[] = [];
                        for (const [k, v] of Object.entries(currentStats)) {
                            statEntities.push(new TimeSeriesStat({
                                metric: k,
                                value: v,
                                granularity: this.statFrequency,
                                manager: this.managerEntity,
                                createdAt: startRange,
                            }));
                        }
                        this.timeSeriesStatsEntities = statEntities;
                    } else {
                        this.timeSeriesStatsEntities = tsStats;
                    }

                    for (const [k, v] of Object.entries(currentStats)) {
                        const matchedStat = this.timeSeriesStatsEntities.find(x => x.metric === k);
                        if (matchedStat !== undefined) {
                            currentStats[k] = matchedStat.value;
                        } else {
                            this.logger.warn(`Could not find time series stat matching '${k}' in the database, will default to 0`);
                            currentStats[k] = v;
                        }
                    }
                }
            } catch (e) {
                this.logger.error(new ErrorWithCause('Failed to init frequency (time series) stats', {cause: e}));
            }
            this.init = true;
        }
    }

    updateHistoricalStats(data: Partial<HistoricalStatsDisplay>) {
        for (const [k, v] of Object.entries(data)) {
            if (this.stats.historical[k] !== undefined && v !== undefined) {
                this.stats.historical[k] += v;
            }
            if (this.stats.timeSeries[k] !== undefined && v !== undefined) {
                this.stats.timeSeries[k] += v;
            }
        }
    }

    getHistoricalDisplayStats(): HistoricalStatsDisplay {
        return this.stats.historical;
    }

    async saveHistoricalStats() {
        if (this.totalStatsEntities !== undefined) {
            for (const [k, v] of Object.entries(this.stats.historical)) {
                const matchedStatIndex = this.totalStatsEntities.findIndex(x => x.metric === k);
                if (matchedStatIndex !== -1) {
                    this.totalStatsEntities[matchedStatIndex].value = v;
                } else {
                    this.logger.warn(`Could not find historical stat matching '${k}' in total stats??`);
                }

            }
            await this.totalStatsRepo.save(this.totalStatsEntities);
        }

        if (this.timeSeriesStatsEntities !== undefined) {
            for (const [k, v] of Object.entries(this.stats.timeSeries)) {
                const matchedStatIndex = this.timeSeriesStatsEntities.findIndex(x => x.metric === k);
                if (matchedStatIndex !== -1) {
                    this.timeSeriesStatsEntities[matchedStatIndex].value = v;
                } else {
                    this.logger.warn(`Could not find time series stat matching '${k}' in total stats??`);
                }

            }
            await this.tsStatsRepo.save(this.timeSeriesStatsEntities);
        }
    }

    setHistoricalSaveInterval() {
        this.historicalSaveInterval = setInterval((function (self) {
            return async () => {
                await self.saveHistoricalStats();
            }
        })(this), 10000);
    }

    getCacheTotals() {
        return Object.values(this.stats.cache).reduce((acc, curr) => ({
            miss: acc.miss + curr.miss,
            req: acc.req + curr.requests,
        }), {miss: 0, req: 0});
    }

    getCacheStats() {
        return this.stats.cache;
    }

    async getCacheStatsForManager() {
        const totals = this.getCacheTotals();
        const cacheKeys = Object.keys(this.stats.cache);
        const res = {
            cache: {
                // TODO could probably combine these two
                totalRequests: totals.req,
                totalMiss: totals.miss,
                missPercent: `${formatNumber(totals.miss === 0 || totals.req === 0 ? 0 : (totals.miss / totals.req) * 100, {toFixed: 0})}%`,
                types: await cacheKeys.reduce(async (accProm, curr) => {
                    const acc = await accProm;
                    // calculate miss percent

                    const per = acc[curr].miss === 0 ? 0 : formatNumber(acc[curr].miss / acc[curr].requests) * 100;
                    acc[curr].missPercent = `${formatNumber(per, {toFixed: 0})}%`;

                    // calculate average identifier hits

                    const idCache = acc[curr].identifierRequestCount;
                    // @ts-expect-error
                    const idKeys = await idCache.store.keys() as string[];
                    if (idKeys.length > 0) {
                        let hits = 0;
                        for (const k of idKeys) {
                            hits += await idCache.get(k) as number;
                        }
                        acc[curr].identifierAverageHit = formatNumber(hits / idKeys.length);
                    }

                    if (acc[curr].requestTimestamps.length > 1) {
                        // calculate average time between request
                        const diffData = acc[curr].requestTimestamps.reduce((accTimestampData, curr: number) => {
                            if (accTimestampData.last === 0) {
                                accTimestampData.last = curr;
                                return accTimestampData;
                            }
                            accTimestampData.diffs.push(curr - accTimestampData.last);
                            accTimestampData.last = curr;
                            return accTimestampData;
                        }, {last: 0, diffs: [] as number[]});
                        const avgDiff = diffData.diffs.reduce((acc, curr) => acc + curr, 0) / diffData.diffs.length;

                        acc[curr].averageTimeBetweenHits = formatNumber(avgDiff / 1000);
                    }

                    const {requestTimestamps, identifierRequestCount, ...rest} = acc[curr];
                    // @ts-ignore
                    acc[curr] = rest;

                    return acc;
                }, Promise.resolve({...this.stats.cache}))
            }
        }
        return res;
    }

    async incrementCacheTypeStat(cacheType: keyof ResourceStats, hash?: string, miss?: boolean) {
        if (this.stats.cache[cacheType] === undefined) {
            this.logger.warn(`Cache type ${cacheType} does not exist. Fix this!`);
        }
        if (hash !== undefined) {
            await this.stats.cache[cacheType].identifierRequestCount.set(hash, (await this.stats.cache[cacheType].identifierRequestCount.wrap(hash, () => 0) as number) + 1);
        }
        this.stats.cache[cacheType].requestTimestamps.push(Date.now());
        this.stats.cache[cacheType].requests++;

        if (miss === true) {
            this.stats.cache[cacheType].miss++;
        }
    }

    resetCacheStats() {
        this.stats.cache = cacheStats();
    }

    async destroy() {
        if (this.historicalSaveInterval !== undefined) {
            clearInterval(this.historicalSaveInterval);
            await this.saveHistoricalStats();
        }
    }
}
