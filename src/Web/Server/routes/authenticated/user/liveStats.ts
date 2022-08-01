import {authUserCheck, botRoute, subredditRoute} from "../../../middleware";
import {Request, Response} from "express";
import Bot from "../../../../../Bot";
import {
    boolToString,
    cacheStats,
    difference,
    filterLogs,
    formatNumber,
    logSortFunc, parseRedditEntity,
    pollingInfo,
    symmetricalDifference
} from "../../../../../util";
import dayjs from "dayjs";
import {LogInfo, ResourceStats, RUNNING, STOPPED, SYSTEM} from "../../../../../Common/interfaces";
import {Manager} from "../../../../../Subreddit/Manager";
import winston from "winston";
import {opStats} from "../../../../Common/util";
import {BotStatusResponse} from "../../../../Common/interfaces";
import deepEqual from "fast-deep-equal";
import {DispatchedEntity} from "../../../../../Common/Entities/DispatchedEntity";
import {
    guestEntitiesToAll,
    guestEntityToApiGuest,
    ManagerGuestEntity
} from "../../../../../Common/Entities/Guest/GuestEntity";
import {Guest} from "../../../../../Common/Entities/Guest/GuestInterfaces";

const lastFullResponse: Map<string, Record<string, any>> = new Map();

const mergeDeepEqual = (a: Record<any, any>, b: Record<any, any>): Record<any, any> => {
    const delta: Record<any, any> = {};
    for(const [k,v] of Object.entries(a)) {
        if(typeof v === 'object' && v !== null && typeof b[k] === 'object' && b[k] !== null) {
            const objDelta = mergeDeepEqual(v, b[k]);
            if(Object.keys(objDelta).length > 0) {
                delta[k] = objDelta;
            }
        } else if(!deepEqual(v, b[k])) {
            delta[k] = v;
        }
    }
    return delta;
}

const generateDeltaResponse = (data: Record<string, any>, hash: string, responseType: 'full' | 'delta') => {
    let resp = data;
    if(responseType === 'delta') {
        const reference = lastFullResponse.get(hash);
        if(reference === undefined) {
            // shouldn't happen...
            return data;
        }
        const delta: Record<string, any> = {};
        for(const [k,v] of Object.entries(data)) {
            switch(k) {
                case 'delayedItems':
                    // on delayed items delta we will send a different data structure back with just remove/new(add)
                    const refIds = reference[k].map((x: DispatchedEntity) => x.id);
                    const latestIds = v.map((x: DispatchedEntity) => x.id);

                    if(symmetricalDifference(refIds, latestIds).length === 0) {
                        continue;
                    }

                    const newIds = Array.from(difference(latestIds, refIds));
                    const newItems = v.filter((x: DispatchedEntity) => newIds.includes(x.id));

                    // just need ids that should be removed on frontend
                    const removedItems = Array.from(difference(refIds, latestIds));
                    delta[k] = {new: newItems, removed: removedItems};
                    break;
                case 'guests':
                    const refNames = reference[k].map((x: Guest) => `${x.name}-${x.expiresAt}`);
                    const latestNames = v.map((x: Guest) => `${x.name}-${x.expiresAt}`);

                    if(symmetricalDifference(refNames, latestNames).length === 0) {
                        continue;
                    }

                    // const newNames = Array.from(difference(latestNames, refNames));
                    // const newGuestItems = v.filter((x: Guest) => newNames.includes(x.name));
                    //
                    // // just need ids that should be removed on frontend
                    // const removedGuestItems = Array.from(difference(refNames, latestNames));
                    // delta[k] = {new: newGuestItems, removed: removedGuestItems};
                    delta[k] = v;
                    break;
                default:
                    if(!deepEqual(v, reference[k])) {
                        if(v !== null && typeof v === 'object' && reference[k] !== null && typeof reference[k] === 'object') {
                            // for things like cache/stats we only want to delta changed properties, not the entire object
                            delta[k] = mergeDeepEqual(v, reference[k]);
                        } else {
                            delta[k] = v;
                        }
                    }
                    break;
            }
        }
        resp = delta;
    }
    lastFullResponse.set(hash, data);
    return resp;
}

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
        const responseType = req.query.type === 'delta' ? 'delta' : 'full';
        const hash = `${bot.botName}${manager !== undefined ? `-${manager.getDisplay()}` : ''}`;
        const isOperator = req.user?.isInstanceOperator(bot);

        const userModerated: string[] = (req.user as Express.User).subreddits.map(x => parseRedditEntity(x).name);

        if(manager === undefined) {
            // getting all
            const subManagerData: any[] = [];
            //let managerGuests: ManagerGuestEntity[] = [];
            for (const m of req.user?.accessibleSubreddits(bot) as Manager[]) {

                const isMod = userModerated.some(x => parseRedditEntity(m.subreddit.display_name).name === x);
                const isGuest = m.managerEntity.getGuests().some(y => y.author.name === req.user?.name);

                //const guests = await m.managerEntity.getGuests();
                //managerGuests = managerGuests.concat(guests);

                const sd = {
                    name: m.displayLabel,
                    guests: isOperator || isMod ? m.managerEntity.getGuests().map(x => guestEntityToApiGuest(x)) : [],
                    queuedActivities: m.queue.length(),
                    runningActivities: m.queue.running(),
                    delayedItems: m.getDelayedSummary(),
                    maxWorkers: m.queue.concurrency,
                    subMaxWorkers: m.subMaxWorkers || bot.maxWorkers,
                    globalMaxWorkers: bot.maxWorkers,
                    isMod,
                    isGuest,
                    checks: {
                        submissions: m.submissionChecks === undefined ? 0 : m.submissionChecks.length,
                        comments: m.commentChecks === undefined ? 0 : m.commentChecks.length,
                    },
                    stats: await m.getStats(),
                }
                if (m.startedAt !== undefined) {
                    const dur = dayjs.duration(dayjs().diff(m.startedAt));

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
                        eventsCheckedTotal: acc.historical.eventsCheckedTotal + curr.stats.historical.eventsCheckedTotal,
                        eventsActionedTotal: acc.historical.eventsActionedTotal + curr.stats.historical.eventsActionedTotal,
                        checksRunTotal: acc.historical.checksRunTotal + curr.stats.historical.checksRunTotal,
                        checksFromCacheTotal: acc.historical.checksFromCacheTotal + curr.stats.historical.checksFromCacheTotal,
                        checksTriggeredTotal: acc.historical.checksTriggeredTotal + curr.stats.historical.checksTriggeredTotal,
                        rulesRunTotal: acc.historical.rulesRunTotal + curr.stats.historical.rulesRunTotal,
                        rulesCachedTotal: acc.historical.rulesCachedTotal + curr.stats.historical.rulesCachedTotal,
                        rulesTriggeredTotal: acc.historical.rulesTriggeredTotal + curr.stats.historical.rulesTriggeredTotal,
                        actionsRunTotal: acc.historical.actionsRunTotal + curr.stats.historical.actionsRunTotal,
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
                    eventsCheckedTotal: 0,
                    eventsActionedTotal: 0,
                    checksRunTotal: 0,
                    checksFromCacheTotal: 0,
                    checksTriggeredTotal: 0,
                    rulesRunTotal: 0,
                    rulesCachedTotal: 0,
                    rulesTriggeredTotal: 0,
                    actionsRunTotal: 0,
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

                delete acc[curr].requestTimestamps;
                delete acc[curr].identifierRequestCount;
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
                guests: guestEntitiesToAll(subManagerData.reduce((acc, curr) => {
                    acc.set(curr.name, curr.guests);
                    return acc;
                }, new Map<string, Guest[]>())),
                isMod: subManagerData.some(x => x.isMod),
                queuedActivities,
                delayedItems,
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
                },
                ...allManagerData,
            };
            const respData = generateDeltaResponse(data, hash, responseType);
            if(Object.keys(respData).length === 0) {
                return res.status(304).send();
            }
            return res.json(respData);
        } else {
            const isGuest = manager.managerEntity.getGuests().some(y => y.author.name === req.user?.name);
            const isMod = userModerated.some(x => parseRedditEntity(manager.subreddit.display_name).name === x);
            // getting specific subreddit stats
            const sd = {
                name: manager.displayLabel,
                botState: manager.managerState,
                eventsState: manager.eventsState,
                queueState: manager.queueState,
                guests: isOperator || isMod ? manager.managerEntity.getGuests().map(x => guestEntityToApiGuest(x)) : [],
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
                isGuest,
                isMod,
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
                system: {
                    running: bot.running,
                }
            };
            // TODO replace indicator data with js on client page
            let indicator;
            if (manager.managerState.state === RUNNING && manager.queueState.state === RUNNING && manager.eventsState.state === RUNNING) {
                indicator = 'green';
            } else if (manager.managerState.state === STOPPED && manager.queueState.state === STOPPED && manager.eventsState.state === STOPPED) {
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

            const respData = generateDeltaResponse(sd, hash, responseType);
            if(Object.keys(respData).length === 0) {
                return res.status(304).send();
            }
            return res.json(respData);
        }
    }
    return [...middleware, response];
}

export default liveStats;
