import {Request, Response} from 'express';
import {
    boolToString,
    cacheStats,
    filterLogBySubreddit, filterLogs,
    formatNumber,
    intersect,
    LogEntry, logSortFunc,
    pollingInfo
} from "../../../../../util";
import {Manager} from "../../../../../Subreddit/Manager";
import dayjs from "dayjs";
import {LogInfo, ResourceStats, RUNNING, STOPPED, SYSTEM} from "../../../../../Common/interfaces";
import {BotStatusResponse} from "../../../../Common/interfaces";
import winston from "winston";
import {opStats} from "../../../../Common/util";
import {authUserCheck, botRoute, subredditRoute} from "../../../middleware";
import Bot from "../../../../../Bot";

const status = () => {

    const middleware = [
        authUserCheck(),
        botRoute(false),
        subredditRoute(false)
    ];

    const response = async (req: Request, res: Response) => {
        let bots: Bot[] = [];
        const {
            limit = 200,
            level = 'verbose',
            sort = 'descending',
        } = req.query;

        bots = req.user?.accessibleBots(req.botApp.bots) as Bot[];

        const botResponses: BotStatusResponse[] = [];
        let index = 1;
        for(const b of bots) {
            botResponses.push(await botStatResponse(b, req, index));
            index++;
        }
        const system: any = {};
        // @ts-ignore
        system.logs = filterLogs(req.sysLogs, {level, sort, limit, user: req.user?.isInstanceOperator(req.botApp) ? undefined : req.user?.name, returnType: 'object' }) as LogInfo[];
        const response = {
            bots: botResponses,
            system: system,
        };
        return res.json(response);
    }

    const botStatResponse = async (bot: Bot, req: Request, index: number) => {
        const {
            //subreddits = [],
            //user: userVal,
            limit = 200,
            level = 'verbose',
            sort = 'descending',
            lastCheck
        } = req.query;

        const allReq = req.query.subreddit !== undefined && (req.query.subreddit as string).toLowerCase() === 'all';

        const subManagerData = [];
        for (const m of req.user?.accessibleSubreddits(bot) as Manager[]) {
            const logs = req.manager === undefined || allReq || req.manager.getDisplay() === m.getDisplay() ? filterLogs(m.logs, {
                    level: (level as string),
                    // @ts-ignore
                    sort,
                    limit: limit as string,
                    returnType: 'object'
                }) as LogInfo[]: [];
            const sd = {
                name: m.displayLabel,
                //linkName: s.replace(/\W/g, ''),
                logs: logs || [], // provide a default empty value in case we truly have not logged anything for this subreddit yet
                botState: m.botState,
                eventsState: m.eventsState,
                queueState: m.queueState,
                indicator: 'gray',
                permissions: [],
                queuedActivities: m.queue.length(),
                runningActivities: m.queue.running(),
                delayedItems: m.getDelayedSummary(),
                maxWorkers: m.queue.concurrency,
                subMaxWorkers: m.subMaxWorkers || bot.maxWorkers,
                globalMaxWorkers: bot.maxWorkers,
                validConfig: boolToString(m.validConfigLoaded),
                configFormat: m.wikiFormat,
                dryRun: boolToString(m.dryRun === true),
                pollingInfo: m.pollOptions.length === 0 ? ['nothing :('] : m.pollOptions.map(pollingInfo),
                checks: {
                    submissions: m.submissionChecks === undefined ? 0 : m.submissionChecks.length,
                    comments: m.commentChecks === undefined ? 0 : m.commentChecks.length,
                },
                wikiLocation: m.wikiLocation,
                wikiHref: `https://reddit.com/r/${m.subreddit.display_name}/wiki/${m.wikiLocation}`,
                wikiRevisionHuman: m.lastWikiRevision === undefined ? 'N/A' : `${dayjs.duration(dayjs().diff(m.lastWikiRevision)).humanize()} ago`,
                wikiRevision: m.lastWikiRevision === undefined ? 'N/A' : m.lastWikiRevision.local().format('MMMM D, YYYY h:mm A Z'),
                wikiLastCheckHuman: `${dayjs.duration(dayjs().diff(m.lastWikiCheck)).humanize()} ago`,
                wikiLastCheck: m.lastWikiCheck.local().format('MMMM D, YYYY h:mm A Z'),
                stats: await m.getStats(),
                startedAt: 'Not Started',
                startedAtHuman: 'Not Started',
                delayBy: m.delayBy === undefined ? 'No' : `Delayed by ${m.delayBy} sec`,
            };
            // TODO replace indicator data with js on client page
            let indicator;
            if (m.botState.state === RUNNING && m.queueState.state === RUNNING && m.eventsState.state === RUNNING) {
                indicator = 'green';
            } else if (m.botState.state === STOPPED && m.queueState.state === STOPPED && m.eventsState.state === STOPPED) {
                indicator = 'red';
            } else {
                indicator = 'yellow';
            }
            sd.indicator = indicator;
            if (m.startedAt !== undefined) {
                const dur = dayjs.duration(dayjs().diff(m.startedAt));
                sd.startedAtHuman = `${dur.humanize()} ago`;
                sd.startedAt = m.startedAt.local().format('MMMM D, YYYY h:mm A Z');

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
            subManagerData.push(sd);
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
                // @ts-ignore
                delayedItems: acc.delayedItems.concat(curr.delayedItems)
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
            delayedItems: [],
        });
        const {
            checks,
            maxWorkers,
            globalMaxWorkers,
            subMaxWorkers,
            runningActivities,
            queuedActivities,
            delayedItems,
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
        const allSubLogs = subManagerData.map(x => x.logs).flat().sort(logSortFunc(sort as string)).slice(0, (limit as number) + 1);
        const allLogs = filterLogs([...allSubLogs, ...(req.user?.isInstanceOperator(req.botApp) ? bot.logs : bot.logs.filter(x => x.user === req.user?.name))], {
            level: (level as string),
            // @ts-ignore
            sort,
            limit: limit as string,
            returnType: 'object'
        }) as LogInfo[];
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
            delayedItems,
            botState: {
                state: RUNNING,
                causedBy: SYSTEM
            },
            dryRun: boolToString(bot.dryRun === true),
            logs: allLogs,
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
        if (allManagerData.logs === undefined) {
            // this should happen but saw an edge case where potentially did
            winston.loggers.get('app').warn(`Logs for 'all' were undefined found but should always have a default empty value`);
        }
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

        const data: BotStatusResponse = {
            system: {
                startedAt: bot.startedAt.local().format('MMMM D, YYYY h:mm A Z'),
                running: bot.running,
                error: bot.error,
                account: (bot.botAccount as string) ?? `Bot ${index}`,
                name: (bot.botName as string) ?? `Bot ${index}`,
                ...opStats(bot),
            },
            subreddits: [allManagerData, ...(allReq ? subManagerData.map(({logs, ...x}) => ({...x, logs: []})) : subManagerData)],

        };

        return data;
    };

    return [...middleware, response];
}

export default status;
