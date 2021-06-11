import Snoowrap, {Comment, RedditUser} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Duration, DurationUnitsObjectType} from "dayjs/plugin/duration";
import dayjs, {Dayjs} from "dayjs";
import Mustache from "mustache";
import he from "he";
import {AuthorOptions, AuthorCriteria, RuleResult} from "../Rule";
import {ActivityWindowCriteria, ActivityWindowType} from "../Common/interfaces";
import {truncateStringToLength} from "../util";

export interface AuthorTypedActivitiesOptions extends AuthorActivitiesOptions {
    type?: 'comment' | 'submission',
}

export interface AuthorActivitiesOptions {
    window: ActivityWindowType | Duration
    chunkSize?: number
}

export async function getAuthorActivities(user: RedditUser, options: AuthorTypedActivitiesOptions): Promise<Array<Submission | Comment>> {

    const {chunkSize: cs = 100} = options;

    let window: number | Dayjs,
        chunkSize = Math.min(cs, 100);
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
    let items: Array<Submission | Comment> = [];
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
    let hitEnd = false;
    let offset = chunkSize;
    while (!hitEnd) {

        if (typeof window === 'number') {
            hitEnd = listing.length >= window;
        } else {
            const listSlice = listing.slice(offset - chunkSize);

            const truncatedItems = listSlice.filter((x) => {
                const utc = x.created_utc * 1000;
                const itemDate = dayjs(utc);
                // @ts-ignore
                return window.isBefore(itemDate);
            });
            if(truncatedItems.length !== listSlice.length) {
                hitEnd = true;
            }
            items = items.concat(truncatedItems);
        }
        if (!hitEnd) {
            hitEnd = listing.isFinished;
        }
        if (!hitEnd) {
            offset += chunkSize;
            listing = await listing.fetchMore({amount: chunkSize});
        } else if(typeof window === 'number') {
            items = listing.slice(0, window + 1);
        }
    }
    // TODO truncate items to window size when duration
    return Promise.resolve(items);
}

export const getAuthorComments = async (user: RedditUser, options: AuthorActivitiesOptions): Promise<Comment[]> => {
    return await getAuthorActivities(user, {...options, type: 'comment'}) as unknown as Promise<Comment[]>;
}

export const getAuthorSubmissions = async (user: RedditUser, options: AuthorActivitiesOptions): Promise<Submission[]> => {
    return await getAuthorActivities(user, {...options, type: 'submission'}) as unknown as Promise<Submission[]>;
}

export const renderContent = async (content: string, data: (Submission | Comment), ruleResults: RuleResult[] = []) => {
    const templateData: any = {
        kind: data instanceof Submission ? 'submission' : 'comment',
        author: await data.author.name,
        permalink: data.permalink,
    }
    if (data instanceof Submission) {
        templateData.url = data.url;
        templateData.title = data.title;
    }
    // normalize rule names and map context data
    // NOTE: we are relying on users to use unique names for rules. If they don't only the last rule run of kind X will have its results here
    const normalizedRuleResults = ruleResults.reduce((acc: object, ruleResult) => {
        const {
            name, triggered,
            data = {},
            result,
            premise: {
                kind
            }
        } = ruleResult;
        // remove all non-alphanumeric characters (spaces, dashes, underscore) and set to lowercase
        // we will set this as the rule property name to make it easy to access results from mustache template
        const normalName = name.trim().replace(/\W+/g, '').toLowerCase()
        return {
            ...acc, [normalName]: {
                kind,
                triggered,
                result,
                ...data,
            }
        };
    }, {});

    return he.decode(Mustache.render(content, {item: templateData, rules: normalizedRuleResults}));
}

export const testAuthorCriteria = async (item: (Comment|Submission), authorOpts: AuthorCriteria, include = true) => {
    // @ts-ignore
    const author: RedditUser = await item.author;
    for(const k of Object.keys(authorOpts)) {
        switch(k) {
            case 'name':
               const authPass = () => {
                   // @ts-ignore
                   for (const n of authorOpts[k]) {
                       if (n.toLowerCase() === author.name.toLowerCase()) {
                          return true;
                       }
                   }
                   return false;
               }
               if((include && !authPass) || (!include && authPass)) {
                   return false;
               }
               break;
            case 'flairCssClass':
                const css = await item.author_flair_css_class;
                const cssPass = () => {
                    // @ts-ignore
                    for(const c of authorOpts[k]) {
                        if(c === css) {
                            return;
                        }
                    }
                    return false;
                }
                if((include && !cssPass) || (!include && cssPass)) {
                    return false;
                }
                break;
            case 'flairText':
                const text = await item.author_flair_text;
                const textPass = () => {
                    // @ts-ignore
                    for(const c of authorOpts[k]) {
                        if(c === text) {
                            return
                        }
                    }
                    return false;
                }
                if((include && !textPass) || (!include && textPass)) {
                    return false;
                }
                break;
            case 'isMod':
                const mods: RedditUser[] = await item.subreddit.getModerators();
                const isModerator = mods.some(x => x.name === item.author.name);
                const modMatch = authorOpts.isMod === isModerator;
                if((include && !modMatch) || (!include && !modMatch)) {
                    return false;
                }
        }
    }
    return true;
}

export interface ItemContent {
    submissionTitle: string,
    content: string,
    author: string,
    permalink: string,
}

export const itemContentPeek = async (item: (Comment | Submission), peekLength = 200): Promise<[string, ItemContent]> => {
    const truncatePeek = truncateStringToLength(peekLength);
    let content = '';
    let submissionTitle = '';
    let peek = '';
    const author = item.author.name;
    if (item instanceof Submission) {
        submissionTitle = item.title;
        peek = `${truncatePeek(item.title)} by ${author} https://reddit.com${item.permalink}`;

    } else if (item instanceof Comment) {
        content = truncatePeek(item.body)
        try {
            // @ts-ignore
            const client = item._r as Snoowrap; // protected? idgaf
            // @ts-ignore
            const commentSub = await client.getSubmission(item.link_id);
            const [p, {submissionTitle: subTitle}] = await itemContentPeek(commentSub);
            submissionTitle = subTitle;
            peek = `${truncatePeek(content)} in ${subTitle} by ${author} https://reddit.com${item.permalink}`;
        } catch (err) {
            // possible comment is not on a submission, just swallow
        }
    }

    return [peek, {submissionTitle, content, author, permalink: item.permalink}];
}

// @ts-ignore
export const getSubmissionFromComment = async (item: Comment): Promise<Submission> => {
    try {
        // @ts-ignore
        const client = item._r as Snoowrap; // protected? idgaf
        // @ts-ignore
        return client.getSubmission(item.link_id);
    } catch (err) {
        // possible comment is not on a submission, just swallow
    }
}

export const getAttributionIdentifier = (sub: Submission, useParentMediaDomain = false) => {
    let domain = sub.domain;
    if (!useParentMediaDomain && sub.secure_media?.oembed !== undefined) {
        const {
            author_url,
            author_name,
        } = sub.secure_media?.oembed;
        if (author_name !== undefined) {
            domain = author_name;
        } else if (author_url !== undefined) {
            domain = author_url;
        }
    }

    return domain;
}
