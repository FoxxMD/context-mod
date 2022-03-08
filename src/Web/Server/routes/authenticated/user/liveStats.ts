import {authUserCheck, botRoute, subredditRoute} from "../../../middleware";
import {Request, Response} from "express";
import Bot from "../../../../../Bot";
import {boolToString, cacheStats, filterLogs, formatNumber, logSortFunc, pollingInfo} from "../../../../../util";
import dayjs from "dayjs";
import {LogInfo, ResourceStats, RUNNING, STOPPED, SYSTEM} from "../../../../../Common/interfaces";
import {Manager} from "../../../../../Subreddit/Manager";
import winston from "winston";
import {opStats} from "../../../../Common/util";
import {BotStatusResponse} from "../../../../Common/interfaces";

const liveStats = () => {
    const middleware = [
        authUserCheck(),
        botRoute(),
        subredditRoute(false),
    ]

    const response = async (req: Request, res: Response) =>
    {
        const bot = req.serverBot as Bot;
        const manager = req.manager;
        
        if(manager === undefined) {
            // getting all
            const subManagerData: any[] = [];
            for (const m of req.user?.accessibleSubreddits(bot) as Manager[]) {
                const sd = {
                    queuedActivities: m.queue.length(),
                    runningActivities: m.queue.running(),
                    maxWorkers: m.queue.concurrency,
                    subMaxWorkers: m.subMaxWorkers || bot.maxWorkers,
                    globalMaxWorkers: bot.maxWorkers,
                    checks: {
                        submissions: m.submissionChecks === undefined ? 0 : m.submissionChecks.length,
                        comments: m.commentChecks === undefined ? 0 : m.commentChecks.length,
                    },
                    stats: await m.getStats(),
                }
            }

            const totalStats = subManagerData.reduce((acc, curr) => {
                return {
                    checks: {
                        submissions: acc.checks.submissions + curr.checks.submissions,
                        comments: acc.checks.comments + curr.checks.comments,
                    },
                    historical: {
                        allTime: {
                            eventsCheckedTotal: acc.historical.allTime.eventsCheckedTotal + curr.stats.historical.allTime.eventsCheckedTotal,
                            eventsActionedTotal: acc.historical.allTime.eventsActionedTotal + curr.stats.historical.allTime.eventsActionedTotal,
                            checksRunTotal: acc.historical.allTime.checksRunTotal + curr.stats.historical.allTime.checksRunTotal,
                            checksFromCacheTotal: acc.historical.allTime.checksFromCacheTotal + curr.stats.historical.allTime.checksFromCacheTotal,
                            checksTriggeredTotal: acc.historical.allTime.checksTriggeredTotal + curr.stats.historical.allTime.checksTriggeredTotal,
                            rulesRunTotal: acc.historical.allTime.rulesRunTotal + curr.stats.historical.allTime.rulesRunTotal,
                            rulesCachedTotal: acc.historical.allTime.rulesCachedTotal + curr.stats.historical.allTime.rulesCachedTotal,
                            rulesTriggeredTotal: acc.historical.allTime.rulesTriggeredTotal + curr.stats.historical.allTime.rulesTriggeredTotal,
                            actionsRunTotal: acc.historical.allTime.actionsRunTotal + curr.stats.historical.allTime.actionsRunTotal,
                        }
                    },
                    maxWorkers: acc.maxWorkers + curr.maxWorkers,
                    subMaxWorkers: acc.subMaxWorkers + curr.subMaxWorkers,
                    globalMaxWorkers: acc.globalMaxWorkers + curr.globalMaxWorkers,
                    runningActivities: acc.runningActivities + curr.runningActivities,
                    queuedActivities: acc.queuedActivities + curr.queuedActivities,
                };
            }, {
                checks: {
                    submissions: 0,
                    comments: 0,
                },
                historical: {
                    allTime: {
                        eventsCheckedTotal: 0,
                        eventsActionedTotal: 0,
                        checksRunTotal: 0,
                        checksFromCacheTotal: 0,
                        checksTriggeredTotal: 0,
                        rulesRunTotal: 0,
                        rulesCachedTotal: 0,
                        rulesTriggeredTotal: 0,
                        actionsRunTotal: 0,
                    }
                },
                maxWorkers: 0,
                subMaxWorkers: 0,
                globalMaxWorkers: 0,
                runningActivities: 0,
                queuedActivities: 0,
            });
            const {
                checks,
                maxWorkers,
                globalMaxWorkers,
                subMaxWorkers,
                runningActivities,
                queuedActivities,
                ...rest
            } = totalStats;

            let cumRaw = subManagerData.reduce((acc, curr) => {
                Object.keys(curr.stats.cache.types as ResourceStats).forEach((k) => {
                    acc[k].requests += curr.stats.cache.types[k].requests;
                    acc[k].miss += curr.stats.cache.types[k].miss;
                    // @ts-ignore
                    acc[k].identifierAverageHit += (typeof curr.stats.cache.types[k].identifierAverageHit === 'string' ? Number.parseFloat(curr.stats.cache.types[k].identifierAverageHit) : curr.stats.cache.types[k].identifierAverageHit);
                    acc[k].averageTimeBetweenHits += curr.stats.cache.types[k].averageTimeBetweenHits === 'N/A' ? 0 : Number.parseFloat(curr.stats.cache.types[k].averageTimeBetweenHits)
                });
                return acc;
            }, cacheStats());
            cumRaw = Object.keys(cumRaw).reduce((acc, curr) => {
                const per = acc[curr].miss === 0 ? 0 : formatNumber(acc[curr].miss / acc[curr].requests) * 100;
                // @ts-ignore
                acc[curr].missPercent = `${formatNumber(per, {toFixed: 0})}%`;
                acc[curr].identifierAverageHit = formatNumber(acc[curr].identifierAverageHit);
                acc[curr].averageTimeBetweenHits = formatNumber(acc[curr].averageTimeBetweenHits)
                return acc;
            }, cumRaw);
            const cacheReq = subManagerData.reduce((acc, curr) => acc + curr.stats.cache.totalRequests, 0);
            const cacheMiss = subManagerData.reduce((acc, curr) => acc + curr.stats.cache.totalMiss, 0);
            const sharedSub = subManagerData.find(x => x.stats.cache.isShared);
            const sharedCount = sharedSub !== undefined ? sharedSub.stats.cache.currentKeyCount : 0;
            const scopes = req.user?.isInstanceOperator(bot) ? bot.client.scope : [];
            let allManagerData: any = {
                name: 'All',
                status: bot.running ? 'RUNNING' : 'NOT RUNNING',
                indicator: bot.running ? 'green' : 'grey',
                maxWorkers,
                globalMaxWorkers,
                scopes: scopes === null || !Array.isArray(scopes) ? [] : scopes,
                subMaxWorkers,
                runningActivities,
                queuedActivities,
                botState: {
                    state: RUNNING,
                    causedBy: SYSTEM
                },
                dryRun: boolToString(bot.dryRun === true),
                checks: checks,
                softLimit: bot.softLimit,
                hardLimit: bot.hardLimit,
                stats: {
                    ...rest,
                    cache: {
                        currentKeyCount: sharedCount + subManagerData.reduce((acc, curr) => curr.stats.cache.isShared ? acc : acc + curr.stats.cache.currentKeyCount,0),
                        isShared: false,
                        totalRequests: cacheReq,
                        totalMiss: cacheMiss,
                        missPercent: `${formatNumber(cacheMiss === 0 || cacheReq === 0 ? 0 : (cacheMiss / cacheReq) * 100, {toFixed: 0})}%`,
                        types: {
                            ...cumRaw,
                        }
                    }
                },
            };
            // if(isOperator) {
            allManagerData.startedAt = bot.startedAt.local().format('MMMM D, YYYY h:mm A Z');
            allManagerData.heartbeatHuman = dayjs.duration({seconds: bot.heartbeatInterval}).humanize();
            allManagerData.heartbeat = bot.heartbeatInterval;
            allManagerData = {...allManagerData, ...opStats(bot)};
            //}

            const botDur = dayjs.duration(dayjs().diff(bot.startedAt))
            if (allManagerData.stats.cache.totalRequests > 0) {
                const minutes = botDur.asMinutes();
                if (minutes < 10) {
                    allManagerData.stats.cache.requestRate = formatNumber((10 / minutes) * allManagerData.stats.cache.totalRequests, {
                        toFixed: 0,
                        round: {enable: true, indicate: true}
                    });
                } else {
                    allManagerData.stats.cache.requestRate = formatNumber(allManagerData.stats.cache.totalRequests / (minutes / 10), {
                        toFixed: 0,
                        round: {enable: true, indicate: true}
                    });
                }
            } else {
                allManagerData.stats.cache.requestRate = 0;
            }

            const data = {
                bot: bot.getBotName(),
                system: {
                    startedAt: bot.startedAt.local().format('MMMM D, YYYY h:mm A Z'),
                    running: bot.running,
                    error: bot.error,
                    ...opStats(bot),
                },
            };
            return res.json(data);
        } else {
            // getting specific subreddit stats
            const sd = {
                name: manager.displayLabel,
                botState: manager.botState,
                eventsState: manager.eventsState,
                queueState: manager.queueState,
                indicator: 'gray',
                permissions: await manager.getModPermissions(),
                queuedActivities: manager.queue.length(),
                runningActivities: manager.queue.running(),
                delayedItems: manager.getDelayedSummary(),
                maxWorkers: manager.queue.concurrency,
                subMaxWorkers: manager.subMaxWorkers || bot.maxWorkers,
                globalMaxWorkers: bot.maxWorkers,
                validConfig: boolToString(manager.validConfigLoaded),
                configFormat: manager.wikiFormat,
                dryRun: boolToString(manager.dryRun === true),
                pollingInfo: manager.pollOptions.length === 0 ? ['nothing :('] : manager.pollOptions.map(pollingInfo),
                checks: {
                    submissions: manager.submissionChecks === undefined ? 0 : manager.submissionChecks.length,
                    comments: manager.commentChecks === undefined ? 0 : manager.commentChecks.length,
                },
                wikiRevisionHuman: manager.lastWikiRevision === undefined ? 'N/A' : `${dayjs.duration(dayjs().diff(manager.lastWikiRevision)).humanize()} ago`,
                wikiRevision: manager.lastWikiRevision === undefined ? 'N/A' : manager.lastWikiRevision.local().format('MMMM D, YYYY h:mm A Z'),
                wikiLastCheckHuman: `${dayjs.duration(dayjs().diff(manager.lastWikiCheck)).humanize()} ago`,
                wikiLastCheck: manager.lastWikiCheck.local().format('MMMM D, YYYY h:mm A Z'),
                stats: await manager.getStats(),
                startedAt: 'Not Started',
                startedAtHuman: 'Not Started',
                delayBy: manager.delayBy === undefined ? 'No' : `Delayed by ${manager.delayBy} sec`,
            };
            // TODO replace indicator data with js on client page
            let indicator;
            if (manager.botState.state === RUNNING && manager.queueState.state === RUNNING && manager.eventsState.state === RUNNING) {
                indicator = 'green';
            } else if (manager.botState.state === STOPPED && manager.queueState.state === STOPPED && manager.eventsState.state === STOPPED) {
                indicator = 'red';
            } else {
                indicator = 'yellow';
            }
            sd.indicator = indicator;
            if (manager.startedAt !== undefined) {
                const dur = dayjs.duration(dayjs().diff(manager.startedAt));
                sd.startedAtHuman = `${dur.humanize()} ago`;
                sd.startedAt = manager.startedAt.local().format('MMMM D, YYYY h:mm A Z');

                if (sd.stats.cache.totalRequests > 0) {
                    const minutes = dur.asMinutes();
                    if (minutes < 10) {
                        sd.stats.cache.requestRate = formatNumber((10 / minutes) * sd.stats.cache.totalRequests, {
                            toFixed: 0,
                            round: {enable: true, indicate: true}
                        });
                    } else {
                        sd.stats.cache.requestRate = formatNumber(sd.stats.cache.totalRequests / (minutes / 10), {
                            toFixed: 0,
                            round: {enable: true, indicate: true}
                        });
                    }
                } else {
                    sd.stats.cache.requestRate = 0;
                }
            }

            return res.json(sd);
        }
    }
    return [...middleware, response];
}

export default liveStats;
