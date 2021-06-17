import Snoowrap, {Comment, RedditUser} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {Duration, DurationUnitsObjectType} from "dayjs/plugin/duration";
import dayjs, {Dayjs} from "dayjs";
import Mustache from "mustache";
import he from "he";
import {AuthorCriteria, RuleResult, UserNoteCriteria} from "../Rule";
import {
    ActivityWindowType,
    CommentState,
    DurationVal,
    SubmissionState,
    TypedActivityStates
} from "../Common/interfaces";
import {isActivityWindowCriteria, normalizeName, truncateStringToLength} from "../util";
import UserNotes from "../Subreddit/UserNotes";
import {Logger} from "winston";

export const BOT_LINK = 'https://www.reddit.com/r/ContextModBot/comments/o1dugk/introduction_to_contextmodbot_and_rcb';

export interface AuthorTypedActivitiesOptions extends AuthorActivitiesOptions {
    type?: 'comment' | 'submission',
}

export interface AuthorActivitiesOptions {
    window: ActivityWindowType | Duration
    chunkSize?: number,
}

export async function getAuthorActivities(user: RedditUser, options: AuthorTypedActivitiesOptions): Promise<Array<Submission | Comment>> {

    const {
        chunkSize: cs = 100,
        window: optWindow
    } = options;

    let satisfiedCount: number | undefined,
        satisfiedEndtime: Dayjs | undefined,
        chunkSize = Math.min(cs, 100),
        satisfy = 'any';

    let durVal: DurationVal | undefined;
    let duration: Duration | undefined;

    if(isActivityWindowCriteria(optWindow)) {
        const { satisfyOn = 'any', count, duration } = optWindow;
        satisfiedCount = count;
        durVal = duration;
        satisfy = satisfyOn
    } else if(typeof optWindow === 'number') {
        satisfiedCount = optWindow;
    } else {
        durVal = optWindow as DurationVal;
    }

    // if count is less than max limit (100) go ahead and just get that many. may result in faster response time for low numbers
    if(satisfiedCount !== undefined) {
        chunkSize = Math.min(chunkSize, satisfiedCount);
    }

    if(durVal !== undefined) {
        const endTime = dayjs();
        if (!dayjs.isDuration(durVal)) {
            // @ts-ignore
            duration = dayjs.duration(durVal);
        }
        if (!dayjs.isDuration(duration)) {
            // TODO print object
            throw new Error('window given was not a number, a valid ISO8601 duration, a Day.js duration, or well-formed Duration options');
        }
        satisfiedEndtime = endTime.subtract(duration.asMilliseconds(), 'milliseconds');
    }

    if(satisfiedCount === undefined && satisfiedEndtime === undefined) {
        throw new Error('window value was not valid');
    } else if(satisfy === 'all' && !(satisfiedCount !== undefined && satisfiedEndtime !== undefined)) {
        // even though 'all' was requested we don't have two criteria so its really 'any' logic
        satisfy = 'any';
    }

    let items: Array<Submission | Comment> = [];
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

        let countOk = false,
            timeOk = false;

        const listSlice = listing.slice(offset - chunkSize)
        if (satisfiedCount !== undefined && items.length + listSlice.length >= satisfiedCount) {
            // satisfied count
            if(satisfy === 'any') {
                items = items.concat(listSlice).slice(0, satisfiedCount);
                break;
            }
            countOk = true;
        }

        let truncatedItems: Array<Submission | Comment> = [];
        if(satisfiedEndtime !== undefined) {
            truncatedItems = listSlice.filter((x) => {
                const utc = x.created_utc * 1000;
                const itemDate = dayjs(utc);
                // @ts-ignore
                return satisfiedEndtime.isBefore(itemDate);
            });

            if (truncatedItems.length !== listSlice.length) {
                if(satisfy === 'any') {
                    // satisfied duration
                    items = items.concat(truncatedItems);
                    break;
                }
                timeOk = true;
            }
        }

        // if we've satisfied everything take whichever is bigger
        if(satisfy === 'all' && countOk && timeOk) {
            if(satisfiedCount as number > items.length + truncatedItems.length) {
                items = items.concat(listSlice).slice(0, satisfiedCount);
            } else {
                items = items.concat(truncatedItems);
            }
            break;
        }

        // if we got this far neither count nor time was satisfied (or both) so just add all items from listing and fetch more if possible
        items = items.concat(listSlice);

        hitEnd = listing.isFinished;

        if (!hitEnd) {
            offset += chunkSize;
            listing = await listing.fetchMore({amount: chunkSize});
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

export const renderContent = async (template: string, data: (Submission | Comment), ruleResults: RuleResult[] = [], usernotes: UserNotes) => {
    const templateData: any = {
        kind: data instanceof Submission ? 'submission' : 'comment',
        author: await data.author.name,
        // make this a getter so that if we don't load notes (and api call) if we don't need to
        // didn't work either for some reason
        // tried to get too fancy :(
        // get notes() {
        //     return usernotes.getUserNotes(data.author).then((notesData) => {
        //         // return usable notes data with some stats
        //         const current = notesData.length > 0 ? notesData[notesData.length -1] : undefined;
        //         // group by type
        //         const grouped = notesData.reduce((acc: any, x) => {
        //             const {[x.noteType]: nt = []} = acc;
        //             return Object.assign(acc, {[x.noteType]: nt.concat(x)});
        //         }, {});
        //         return {
        //             data: notesData,
        //             current,
        //             ...grouped,
        //         };
        //     });
        // },
        // when i was trying to use mustache-async (didn't work)
        // notes: async () => {
        //     const notesData = await usernotes.getUserNotes(data.author);
        //     // return usable notes data with some stats
        //     const current = notesData.length > 0 ? notesData[notesData.length -1] : undefined;
        //     // group by type
        //     const grouped = notesData.reduce((acc: any, x) => {
        //         const {[x.noteType]: nt = []} = acc;
        //         return Object.assign(acc, {[x.noteType]: nt.concat(x)});
        //     }, {});
        //     return {
        //         data: notesData,
        //         current,
        //         ...grouped,
        //     };
        // },
        permalink: data.permalink,
        botLink: BOT_LINK,
    }
    if(template.includes('{{item.notes')) {
        // we need to get notes
        const notesData = await usernotes.getUserNotes(data.author);
        // return usable notes data with some stats
        const current = notesData.length > 0 ? notesData[notesData.length -1] : undefined;
        // group by type
        const grouped = notesData.reduce((acc: any, x) => {
            const {[x.noteType]: nt = []} = acc;
            return Object.assign(acc, {[x.noteType]: nt.concat(x)});
        }, {});
        templateData.notes = {
            data: notesData,
            current,
            ...grouped,
        };
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
        const normalName = normalizeName(name);
        return {
            ...acc, [normalName]: {
                kind,
                triggered,
                result,
                ...data,
            }
        };
    }, {});

    const view = {item: templateData, rules: normalizedRuleResults};
    const rendered = Mustache.render(template, view) as string;
    return he.decode(rendered);
}

export const testAuthorCriteria = async (item: (Comment | Submission), authorOpts: AuthorCriteria, include = true, userNotes: UserNotes) => {
    // @ts-ignore
    const author: RedditUser = await item.author;
    for (const k of Object.keys(authorOpts)) {
        // @ts-ignore
        if (authorOpts[k] !== undefined) {
            switch (k) {
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
                    const authResult = authPass();
                    if ((include && !authResult) || (!include && authResult)) {
                        return false;
                    }
                    break;
                case 'flairCssClass':
                    const css = await item.author_flair_css_class;
                    const cssPass = () => {
                        // @ts-ignore
                        for (const c of authorOpts[k]) {
                            if (c === css) {
                                return;
                            }
                        }
                        return false;
                    }
                    const cssResult = cssPass();
                    if ((include && !cssResult) || (!include && cssResult)) {
                        return false;
                    }
                    break;
                case 'flairText':
                    const text = await item.author_flair_text;
                    const textPass = () => {
                        // @ts-ignore
                        for (const c of authorOpts[k]) {
                            if (c === text) {
                                return
                            }
                        }
                        return false;
                    };
                    const textResult = textPass();
                    if ((include && !textResult) || (!include && textResult)) {
                        return false;
                    }
                    break;
                case 'isMod':
                    const mods: RedditUser[] = await item.subreddit.getModerators();
                    const isModerator = mods.some(x => x.name === item.author.name);
                    const modMatch = authorOpts.isMod === isModerator;
                    if ((include && !modMatch) || (!include && !modMatch)) {
                        return false;
                    }
                    break;
                case 'userNotes':
                    const notes = await userNotes.getUserNotes(item.author);
                    const notePass = () => {
                        for (const noteCriteria of authorOpts[k] as UserNoteCriteria[]) {
                            const {count = 1, order = 'descending', search = 'current', type} = noteCriteria;
                            switch (search) {
                                case 'current':
                                    if (notes.length > 0 && notes[notes.length - 1].noteType === type) {
                                        return true;
                                    }
                                    break;
                                case 'consecutive':
                                    let orderedNotes = notes;
                                    if (order === 'descending') {
                                        orderedNotes = [...notes];
                                        orderedNotes.reverse();
                                    }
                                    let currCount = 0;
                                    for (const note of orderedNotes) {
                                        if (note.noteType === type) {
                                            currCount++;
                                        } else {
                                            currCount = 0;
                                        }
                                        if (currCount >= count) {
                                            return true;
                                        }
                                    }
                                    break;
                                case 'total':
                                    if (notes.filter(x => x.noteType === type).length >= count) {
                                        return true;
                                    }
                            }
                        }
                        return false;
                    }
                    const noteResult = notePass();
                    if ((include && !noteResult) || (!include && noteResult)) {
                        return false;
                    }
                    break;
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

export const isItem = (item: Submission | Comment, stateCriteria: TypedActivityStates, logger: Logger): [boolean, SubmissionState|CommentState|undefined] => {
    if (stateCriteria.length === 0) {
        return [true, undefined];
    }

    const log = logger.child({leaf: 'Item Check'});

    for (const crit of stateCriteria) {
        const [pass, passCrit] = (() => {
            for (const k of Object.keys(crit)) {
                // @ts-ignore
                if (crit[k] !== undefined) {
                    // @ts-ignore
                    if (item[k] !== undefined) {
                        // @ts-ignore
                        if (item[k] !== crit[k]) {
                            return [false, crit];
                        }
                    } else {
                        log.warn(`Tried to test for Item property '${k}' but it did not exist`);
                    }
                }
            }
            log.verbose(`itemIs passed: ${JSON.stringify(crit)}`);
            return [true, crit];
        })() as [boolean, SubmissionState|CommentState|undefined];
        if (pass) {
            return [true, passCrit];
        }
    }
    return [false, undefined];
}
