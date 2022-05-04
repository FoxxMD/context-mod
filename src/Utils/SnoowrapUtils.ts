import Snoowrap, {Listing, RedditUser} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {Duration, DurationUnitsObjectType} from "dayjs/plugin/duration";
import dayjs, {Dayjs} from "dayjs";
import Mustache from "mustache";
import he from "he";
import {
    ActivityWindowType, AuthorCriteria, CommentState, DomainInfo,
    DurationVal, FilterCriteriaPropertyResult, FilterCriteriaResult, RuleResult,
    SubmissionState,
    TypedActivityStates, UserNoteCriteria
} from "../Common/interfaces";
import {
    asSubmission,
    asUserNoteCriteria,
    compareDurationValue,
    comparisonTextOp, escapeRegex, formatNumber, getActivityAuthorName,
    isActivityWindowCriteria, isSubmission, isUserNoteCriteria,
    normalizeName,
    parseDuration,
    parseDurationComparison, parseDurationValToDuration,
    parseGenericValueComparison,
    parseGenericValueOrPercentComparison,
    parseRuleResultsToMarkdownSummary, parseStringToRegex,
    parseSubredditName, removeUndefinedKeys,
    truncateStringToLength, userNoteCriteriaSummary, windowToActivityWindowCriteria
} from "../util";
import UserNotes from "../Subreddit/UserNotes";
import {Logger} from "winston";
import InvalidRegexError from "./InvalidRegexError";
import {URL} from "url";
import {SimpleError, isStatusError, MaybeSeriousErrorWithCause} from "./Errors";
import {Dictionary, ElementOf, SafeDictionary} from "ts-essentials";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {ErrorWithCause} from "pony-cause";

export const BOT_LINK = 'https://www.reddit.com/r/ContextModBot/comments/otz396/introduction_to_contextmodbot';

export interface AuthorTypedActivitiesOptions extends AuthorActivitiesOptions {
    type?: 'comment' | 'submission',
}

export interface AuthorActivitiesOptions {
    window: ActivityWindowType | Duration
    chunkSize?: number,
    // TODO maybe move this into window
    keepRemoved?: boolean,
    [key: string]: any,
}

export async function getActivities(listingFunc: (limit: number) => Promise<Listing<Submission | Comment>>, options: AuthorActivitiesOptions): Promise<Array<Submission | Comment>> {

    const {
        chunkSize: cs = 100,
        window: optWindow,
        keepRemoved = true,
        ...restFetchOptions
    } = options;

    let satisfiedCount: number | undefined,
        satisfiedEndtime: Dayjs | undefined,
        chunkSize = Math.min(cs, 100),
        satisfy = 'any';

    let durVal: DurationVal | undefined;
    let duration: Duration | undefined;

    let includes: string[] = [];
    let excludes: string[] = [];

    const strongWindow = windowToActivityWindowCriteria(optWindow);

    const {
        satisfyOn = 'any',
        count,
        duration: oDuration,
        subreddits: {
            include = [],
            exclude = [],
        } = {},
    } = strongWindow;

    satisfy = satisfyOn;
    satisfiedCount = count;
    includes = include;
    excludes = exclude;
    durVal = oDuration;

    if (includes.length > 0 && excludes.length > 0) {
        // TODO add logger so this can be logged...
        // this.logger.warn('include and exclude both specified, exclude will be ignored');
    }

    // if (isActivityWindowCriteria(optWindow)) {
    //     const {
    //         satisfyOn = 'any',
    //         count,
    //         duration,
    //         subreddits: {
    //             include = [],
    //             exclude = [],
    //         } = {},
    //     } = optWindow;
    //
    //     includes = include.map(x => parseSubredditName(x).toLowerCase());
    //     excludes = exclude.map(x => parseSubredditName(x).toLowerCase());
    //
    //     if (includes.length > 0 && excludes.length > 0) {
    //         // TODO add logger so this can be logged...
    //         // this.logger.warn('include and exclude both specified, exclude will be ignored');
    //     }
    //     satisfiedCount = count;
    //     durVal = duration;
    //     satisfy = satisfyOn
    // } else if (typeof optWindow === 'number') {
    //     satisfiedCount = optWindow;
    // } else {
    //     durVal = optWindow as DurationVal;
    // }

    // if count is less than max limit (100) go ahead and just get that many. may result in faster response time for low numbers
    if (satisfiedCount !== undefined) {
        chunkSize = Math.min(chunkSize, satisfiedCount);
    }

    if (durVal !== undefined) {
        const endTime = dayjs();
        const duration = parseDurationValToDuration(durVal);
        satisfiedEndtime = endTime.subtract(duration.asMilliseconds(), 'milliseconds');
    }

    if (satisfiedCount === undefined && satisfiedEndtime === undefined) {
        throw new Error('window value was not valid');
    } else if (satisfy === 'all' && !(satisfiedCount !== undefined && satisfiedEndtime !== undefined)) {
        // even though 'all' was requested we don't have two criteria so its really 'any' logic
        satisfy = 'any';
    }

    let items: Array<Submission | Comment> = [];

    let listing = await listingFunc(chunkSize);
    let hitEnd = false;
    let offset = chunkSize;
    while (!hitEnd) {

        let countOk = false,
            timeOk = false;

        let listSlice = listing.slice(offset - chunkSize)
        // TODO partition list by filtered so we can log a debug statement with count of filtered out activities
        if (includes.length > 0) {
            listSlice = listSlice.filter(x => {
                const actSub = x.subreddit.display_name.toLowerCase();
                return includes.includes(actSub);
            });
        } else if (excludes.length > 0) {
            listSlice = listSlice.filter(x => {
                const actSub = x.subreddit.display_name.toLowerCase();
                return !excludes.includes(actSub);
            });
        }

        if (!keepRemoved) {
            // snoowrap typings think 'removed' property does not exist on submission
            // @ts-ignore
            listSlice = listSlice.filter(x => !activityIsRemoved(x));
        }

        // its more likely the time criteria is going to be hit before the count criteria
        // so check this first
        let truncatedItems: Array<Submission | Comment> = [];
        if (satisfiedEndtime !== undefined) {
            truncatedItems = listSlice.filter((x) => {
                const utc = x.created_utc * 1000;
                const itemDate = dayjs(utc);
                // @ts-ignore
                return satisfiedEndtime.isBefore(itemDate);
            });

            if (truncatedItems.length !== listSlice.length) {
                if (satisfy === 'any') {
                    // satisfied duration
                    items = items.concat(truncatedItems);
                    break;
                }
                timeOk = true;
            }
        }

        if (satisfiedCount !== undefined && items.length + listSlice.length >= satisfiedCount) {
            // satisfied count
            if (satisfy === 'any') {
                items = items.concat(listSlice).slice(0, satisfiedCount);
                break;
            }
            countOk = true;
        }

        // if we've satisfied everything take whichever is bigger
        if (satisfy === 'all' && countOk && timeOk) {
            if (satisfiedCount as number > items.length + truncatedItems.length) {
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
            listing = await listing.fetchMore({amount: chunkSize, ...restFetchOptions});
        }
    }
    return Promise.resolve(items);
}

export async function getAuthorActivities(user: RedditUser, options: AuthorTypedActivitiesOptions): Promise<Array<Submission | Comment>> {

    const listFunc = (chunkSize: number): Promise<Listing<Submission | Comment>> => {
        switch (options.type) {
            case 'comment':
                return user.getComments({limit: chunkSize, sort: 'new'});
            case 'submission':
                return user.getSubmissions({limit: chunkSize, sort: 'new'});
            default:
                return user.getOverview({limit: chunkSize, sort: 'new'});
        }
    };
    try {
        return await getActivities(listFunc, options);
    } catch (err: any) {
        if(isStatusError(err)) {
            switch(err.statusCode) {
                case 404:
                    throw new SimpleError('Reddit returned a 404 for user history. Likely this user is shadowbanned.', {isSerious: false});
                case 403:
                    throw new MaybeSeriousErrorWithCause('Reddit returned a 403 for user history, likely this user is suspended.', {cause: err, isSerious: false});
                default:
                    throw err;
            }

        } else {
            throw err;
        }
    }
}

export const getAuthorComments = async (user: RedditUser, options: AuthorActivitiesOptions): Promise<Comment[]> => {
    return await getAuthorActivities(user, {...options, type: 'comment'}) as unknown as Promise<Comment[]>;
}

export const getAuthorSubmissions = async (user: RedditUser, options: AuthorActivitiesOptions): Promise<Submission[]> => {
    return await getAuthorActivities(user, {...options, type: 'submission'}) as unknown as Promise<Submission[]>;
}

export const renderContent = async (template: string, data: (Submission | Comment), ruleResults: RuleResultEntity[] = [], usernotes: UserNotes) => {
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
        permalink: `https://reddit.com${data.permalink}`,
        botLink: BOT_LINK,
    }
    if (template.includes('{{item.notes')) {
        // we need to get notes
        const notesData = await usernotes.getUserNotes(data.author);
        // return usable notes data with some stats
        const current = notesData.length > 0 ? notesData[notesData.length - 1] : undefined;
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
            //name,
            triggered,
            data = {},
            result,
            // premise: {
            //     kind
            // }
        } = ruleResult;
        let name = ruleResult.premise.name;
        const kind = ruleResult.premise.kind.name;
        if(name === undefined || name === null) {
            name = kind;
        }
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

    const view = {item: templateData, ruleSummary: parseRuleResultsToMarkdownSummary(ruleResults), rules: normalizedRuleResults};
    const rendered = Mustache.render(template, view) as string;
    return he.decode(rendered);
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
    const author = getActivityAuthorName(item.author);
    if (asSubmission(item)) {
        submissionTitle = item.title;
        content = truncatePeek(item.title);
        peek = `${truncatePeek(item.title)} by ${author} https://reddit.com${item.permalink}`;

    } else {
        // replace newlines with spaces to make peek more compact
        content = truncatePeek(item.body.replaceAll('\n', ' '));
        peek = `${truncatePeek(content)} by ${author} in https://reddit.com${item.permalink}`;
    }

    return [peek, {submissionTitle, content, author, permalink: item.permalink}];
}

const SPOTIFY_PODCAST_AUTHOR_REGEX: RegExp = /this episode from (?<author>.*?) on Spotify./;
const SPOTIFY_PODCAST_AUTHOR_REGEX_URL = 'https://regexr.com/61c2f';

const SPOTIFY_MUSIC_AUTHOR_REGEX: RegExp = /Listen to .*? on Spotify.\s(?<author>.+?)\s·\s(?<mediaType>.+?)\s/;
const SPOTIFY_MUSIC_AUTHOR_REGEX_URL = 'https://regexr.com/61c2r';

const ANCHOR_AUTHOR_REGEX: RegExp = /by (?<author>.+?)$/;
const ANCHOR_AUTHOR_REGEX_URL = 'https://regexr.com/61c31';

export const getAttributionIdentifier = (sub: Submission, useParentMediaDomain = false): DomainInfo => {
    let domain: string = '';
    let displayDomain: string = '';
    let domainIdents: string[] = useParentMediaDomain ? [sub.domain] : [];
    let provider: string | undefined;
    let mediaType: string | undefined;
    if (!useParentMediaDomain && sub.secure_media?.oembed !== undefined) {
        const {
            author_url,
            author_name,
            description,
            provider_name,
        } = sub.secure_media?.oembed;
        switch (provider_name) {
            case 'Spotify':
                if (description !== undefined) {
                    let match = description.match(SPOTIFY_PODCAST_AUTHOR_REGEX);
                    if (match !== null) {
                        const {author} = match.groups as any;
                        displayDomain = author;
                        domainIdents.push(author);
                        mediaType = 'Podcast';
                    } else {
                        match = description.match(SPOTIFY_MUSIC_AUTHOR_REGEX);
                        if (match !== null) {
                            const {author, mediaType: mt} = match.groups as any;
                            displayDomain = author;
                            domainIdents.push(author);
                            mediaType = mt.toLowerCase();
                        }
                    }
                }
                break;
            case 'Anchor FM Inc.':
                if (author_name !== undefined) {
                    let match = author_name.match(ANCHOR_AUTHOR_REGEX);
                    if (match !== null) {
                        const {author} = match.groups as any;
                        displayDomain = author;
                        domainIdents.push(author);
                        mediaType = 'podcast';
                    }
                }
                break;
            case 'YouTube':
                mediaType = 'Video/Audio';
                break;
            default:
            // nah
        }
        // handles yt, vimeo, twitter fine
        if (displayDomain === '') {
            if (author_name !== undefined) {
                domainIdents.push(author_name);
                if (displayDomain === '') {
                    displayDomain = author_name;
                }
            }
            if (author_url !== undefined) {
                domainIdents.push(author_url);
                domain = author_url;
                if (displayDomain === '') {
                    displayDomain = author_url;
                }
            }
        }
        if (displayDomain === '') {
            // we have media but could not parse stuff for some reason just use url
            const u = new URL(sub.url);
            displayDomain = u.pathname;
            domainIdents.push(u.pathname);
        }
        provider = provider_name;
    } else if (sub.secure_media?.type !== undefined) {
        domainIdents.push(sub.secure_media?.type);
        domain = sub.secure_media?.type;
    } else {
        domain = sub.domain;
    }

    if (domain === '') {
        domain = sub.domain;
    }
    if (displayDomain === '') {
        displayDomain = domain;
    }
    if(domainIdents.length === 0 && domain !== '') {
        domainIdents.push(domain);
    }

    return {display: displayDomain, domain, aliases: domainIdents, provider, mediaType};
}

export const activityIsRemoved = (item: Submission | Comment): boolean => {
    if(item.can_mod_post) {
        if (item instanceof Submission) {
            // when automod filters a post it gets this category
            return item.banned_at_utc !== null && item.removed_by_category !== 'automod_filtered';
        }
        // when automod filters a comment item.removed === false
        // so if we want to processing filtered comments we need to check for this
        return item.banned_at_utc !== null && item.removed;
    } else {
        if (item instanceof Submission) {
            return item.removed_by_category === 'moderator' || item.removed_by_category === 'deleted';
        }
        // in subreddits the bot does not mod it is not possible to tell the difference between a comment that was removed by the user and one that was removed by a mod
        return item.body === '[removed]';
    }
}

export const activityIsFiltered = (item: Submission | Comment): boolean => {
    if(item.can_mod_post) {
        if (item instanceof Submission) {
            // when automod filters a post it gets this category
            return item.banned_at_utc !== null && item.removed_by_category === 'automod_filtered';
        }
        // when automod filters a comment item.removed === false
        // so if we want to processing filtered comments we need to check for this
        return item.banned_at_utc !== null && !item.removed;
    }
    // not possible to know if its filtered if user isn't a mod so always return false
    return false;
}

export const activityIsDeleted = (item: Submission | Comment): boolean => {
    if (item instanceof Submission) {
        return item.removed_by_category === 'deleted';
    }
    return item.author.name === '[deleted]'
}
