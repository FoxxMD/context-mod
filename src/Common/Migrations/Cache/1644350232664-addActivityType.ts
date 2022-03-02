import {Cache} from 'cache-manager';
import {ActionedEvent, CheckSummary, RunResult} from "../../interfaces";
import {
    COMMENT_URL_ID,
    parseLinkIdentifier,
    parseStringToRegex,
    redisScanIterator,
    SUBMISSION_URL_ID
} from "../../../util";
const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

const commentPeekHint = new RegExp(/by .+ in/i);

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
        const newEvents = (oldEvents as any[]).map(x => {
            const {
                activity,
                subreddit,
                author,
                ...rest
            } = x;

            const {
                peek,
                link,
            } = activity;

            let actType;
            let id;

            try {
                // this *should* work
                const commentId = commentReg(`https://reddit.com${link}`);
                if(commentId === undefined) {
                    const submissionId = submissionReg(`https://reddit.com${link}`);
                    actType = 'submission';
                    id = submissionId;
                } else {
                    actType = 'comment';
                    id = commentId;
                }
            } catch(e: any) {
                // but if it doesn't fall back to looking for 'in' in the peek since that means "comment in submission"
                actType = commentPeekHint.test(peek as string) ? 'comment' : 'submission';
            }

            const result: ActionedEvent = {
                activity: {
                    peek,
                    link,
                    type: actType,
                    id,
                    subreddit,
                    author
                },
                subreddit,
                ...rest,
            }
            return result;
        });
       await client.set(k, newEvents, {ttl: 0});
    }
}

export const down = async (context: any, next: any) => {
    // backwards compatible with previous structure, not needed
}
