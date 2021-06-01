import {Comment, RedditUser, Submission} from "snoowrap";
import {Duration, DurationUnitsObjectType} from "dayjs/plugin/duration";
import dayjs, {Dayjs} from "dayjs";

export interface AuthorTypedActivitiesOptions extends AuthorActivitiesOptions {
    type?: 'comment' | 'submission',
}

export interface AuthorActivitiesOptions {
    window: number | string | Duration | DurationUnitsObjectType
}

export async function getAuthorActivities(user: RedditUser, options: AuthorTypedActivitiesOptions): Promise<Array<Submission|Comment>>  {

    let window: number | Dayjs,
        chunkSize = 30;
    if (typeof options.window !== 'number') {
        const endTime = dayjs();
        let d;
        if (dayjs.isDuration(options.window)) {
            d = options.window;
        } else {
            // @ts-ignore
            d = dayjs.duration(options.window);
        }
        if (!dayjs.isDuration(d)) {
            // TODO print object
            throw new Error('window given was not a number, a valid ISO8601 duration, a Day.js duration, or well-formed Duration options');
        }
        window = endTime.subtract(d.asMilliseconds(), 'milliseconds');
    } else {
        window = options.window;
        // use whichever is smaller so we only do one api request if window is smaller than default chunk size
        chunkSize = Math.min(chunkSize, window);
    }
    let items: Array<Submission|Comment> = [];
    let lastItemDate;
    //let count = 1;
    let listing;
        switch (options.type) {
            case 'comment':
                listing = await user.getComments({limit: chunkSize});
                break;
            case 'submission':
                listing = await user.getSubmissions({limit: chunkSize});
                break;
            default:
                listing = await user.getOverview({limit: chunkSize});
                break;
        }
    let hitEnd = listing.isFinished;
    while (!hitEnd) {
        items = items.concat(listing);
        if (typeof window === 'number') {
            hitEnd = items.length >= window
        } else {
            const lastItem = listing[listing.length - 1];
            const lastUtc = await lastItem.created_utc
            lastItemDate = dayjs(lastUtc);
            if (lastItemDate.isBefore(window)) {
                hitEnd = true;
            }
        }
        if(!hitEnd) {
            hitEnd = listing.isFinished;
        }
        if(!hitEnd) {
            listing.fetchMore({amount: chunkSize});
        }
    }
    return Promise.resolve(items);
}

export const getAuthorComments = async (user: RedditUser, options: AuthorActivitiesOptions): Promise<Comment[]> => {
    return await getAuthorActivities(user, {...options, type: 'comment'}) as unknown as Promise<Comment[]>;
}

export const getAuthorSubmissions = async (user: RedditUser, options: AuthorActivitiesOptions): Promise<Submission[]> => {
    return await getAuthorActivities(user, {...options, type: 'submission'}) as unknown as Promise<Submission[]>;
}
