import {Cache} from 'cache-manager';
import {ActionedEvent, CheckSummary, RunResult} from "../../interfaces";
import {escapeRegex, parseStringToRegex, redisScanIterator} from "../../../util";

export const up = async (context: any, next: any) => {
    const client = context.client as Cache;
    const prefix = context.prefix as string | undefined;

    const subredditEventMap: Record<string, any[] | undefined> = {};

    // @ts-ignore
    if(client.store.name === 'redis') {
        // @ts-ignore
        for await (const key of redisScanIterator(client.store.getClient(), { MATCH: `${prefix !== undefined ? prefix : ''}actionedEvents-*` })) {
            const nonPrefixedKey = prefix !== undefined ? key.replace(prefix, '') : key;
            subredditEventMap[nonPrefixedKey] = await client.get(nonPrefixedKey);
        }
    } else if(client.store.keys !== undefined) {
        const eventsReg = parseStringToRegex(`/${prefix !== undefined ? escapeRegex(prefix) : ''}actionedEvents-.*/i`) as RegExp;
        for (const key of await client.store.keys()) {
            if(eventsReg.test(key)) {
                const nonPrefixedKey = prefix !== undefined ? key.replace(prefix, '') : key;
                subredditEventMap[nonPrefixedKey] = await client.get(nonPrefixedKey);
            }
        }
    }

    for (const [k, v] of Object.entries(subredditEventMap)) {
        const oldEvents = v;
        if (oldEvents === null || oldEvents === undefined) {
            continue;
        }
        const newEvents = (oldEvents as any[]).map(x => {
            const {
                ruleSummary,
                ruleResults = [],
                actionResults = [],
                check,
                ...rest
            } = x;
            if (check === undefined || check === null) {
                // probably new structure, leave it alone
                return x;
            }
            // otherwise wrap in dummy run
            const result: ActionedEvent = {
                ...rest,
                runResults: [
                    {
                        name: 'Run1',
                        triggered: true,
                        checkResults: [
                            {
                                name: check,
                                run: 'Run1',
                                postBehavior: 'nextRun',
                                triggered: true,
                                condition: ruleSummary.includes('OR') ? 'OR' : 'AND',
                                ruleResults,
                                actionResults,
                            }
                        ],
                    }
                ]
            }
            return result;
        });
        await client.set(k, newEvents, {ttl: 0});
    }
}

export const down = async (context: any, next: any) => {
    const client = context.client as Cache;
    const prefix = context.prefix as string | undefined;

    const subredditEventMap: Record<string, any[] | undefined> = {};

    // @ts-ignore
    if(client.store.name === 'redis') {
        // @ts-ignore
        for await (const key of redisScanIterator(client.store.getClient(), { MATCH: `${prefix !== undefined ? prefix : ''}actionedEvents-*` })) {
            const nonPrefixedKey = prefix !== undefined ? key.replace(prefix, '') : key;
            subredditEventMap[nonPrefixedKey] = await client.get(nonPrefixedKey);
        }
    } else if(client.store.keys !== undefined) {
        const eventsReg = parseStringToRegex(`/${prefix !== undefined ? prefix : ''}actionedEvents-.*/i`) as RegExp;
        for (const key of await client.store.keys()) {
            if(eventsReg.test(key)) {
                const nonPrefixedKey = prefix !== undefined ? key.replace(prefix, '') : key;
                subredditEventMap[nonPrefixedKey] = await client.get(nonPrefixedKey);
            }
        }
    }

    for (const [k, v] of Object.entries(subredditEventMap)) {
        const oldEvents = v;
        if (oldEvents === null || oldEvents === undefined) {
            continue;
        }
        // don't want to lose any multi-check events so create one event per check
        const newEvents = (oldEvents as any[]).reduce((acc, curr) => {
            if (curr.check !== undefined) {
                // its an old event so just return it
                acc.push(curr);
                return acc;
            }
            const {runResults = [], ...rest} = curr;
            const singleEvents = (runResults as RunResult[]).map(y => {
                return {
                    ...rest,
                    ruleResults: y.checkResults[0].ruleResults,
                    actionResults: y.checkResults[0].actionResults,
                    check: y.name,
                }
            });
            return acc.concat(singleEvents);
        }, []);
        await client.set(k, newEvents, {ttl: 0});
    }
}
