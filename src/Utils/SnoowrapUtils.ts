import Snoowrap, {Listing, RedditUser} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {Duration, DurationUnitsObjectType} from "dayjs/plugin/duration";
import dayjs, {Dayjs} from "dayjs";
import Mustache from "mustache";
import he from "he";
import {RuleResult, UserNoteCriteria} from "../Rule";
import {
    ActivityWindowType, CommentState, DomainInfo,
    DurationVal, FilterCriteriaPropertyResult, FilterCriteriaResult,
    SubmissionState,
    TypedActivityStates
} from "../Common/interfaces";
import {
    asSubmission,
    asUserNoteCriteria,
    compareDurationValue,
    comparisonTextOp, escapeRegex, formatNumber, getActivityAuthorName,
    isActivityWindowCriteria, isSubmission, isUserNoteCriteria,
    normalizeName,
    parseDuration,
    parseDurationComparison,
    parseGenericValueComparison,
    parseGenericValueOrPercentComparison,
    parseRuleResultsToMarkdownSummary, parseStringToRegex,
    parseSubredditName, removeUndefinedKeys,
    truncateStringToLength, userNoteCriteriaSummary, windowToActivityWindowCriteria
} from "../util";
import UserNotes from "../Subreddit/UserNotes";
import {Logger} from "winston";
import InvalidRegexError from "./InvalidRegexError";
import {AuthorCriteria} from "../Author/Author";
import {URL} from "url";
import {SimpleError, isStatusError} from "./Errors";
import {Dictionary, ElementOf, SafeDictionary} from "ts-essentials";

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
        if (typeof durVal === 'object') {
            duration = dayjs.duration(durVal);
            if (!dayjs.isDuration(duration)) {
                throw new Error('window value given was not a well-formed Duration object');
            }
        } else {
            try {
                duration = parseDuration(durVal);
            } catch (e) {
                if (e instanceof InvalidRegexError) {
                    throw new Error(`window value of '${durVal}' could not be parsed as a valid ISO8601 duration or DayJS duration shorthand (see Schema)`);
                }
                throw e;
            }
        }
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
                return user.getComments({limit: chunkSize});
            case 'submission':
                return user.getSubmissions({limit: chunkSize});
            default:
                return user.getOverview({limit: chunkSize});
        }
    };
    try {
        return await getActivities(listFunc, options);
    } catch (err: any) {
        if(isStatusError(err) && err.statusCode === 404) {
            throw new SimpleError('Reddit returned a 404 for user history. Likely this user is shadowbanned.');
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

    const view = {item: templateData, ruleSummary: parseRuleResultsToMarkdownSummary(ruleResults), rules: normalizedRuleResults};
    const rendered = Mustache.render(template, view) as string;
    return he.decode(rendered);
}

type AuthorCritPropHelper = SafeDictionary<FilterCriteriaPropertyResult<AuthorCriteria>, keyof AuthorCriteria>;
type RequiredAuthorCrit = Required<AuthorCriteria>;

export const testAuthorCriteria = async (item: (Comment | Submission), authorOpts: AuthorCriteria, include = true, userNotes: UserNotes): Promise<FilterCriteriaResult<AuthorCriteria>> => {


    const definedAuthorOpts = (removeUndefinedKeys(authorOpts) as RequiredAuthorCrit);

    const propResultsMap = Object.entries(definedAuthorOpts).reduce((acc: AuthorCritPropHelper, [k, v]) => {
        const key = (k as keyof AuthorCriteria);
        let ex;
        if (Array.isArray(v)) {
            ex = v.map(x => {
                if (asUserNoteCriteria(x)) {
                    return userNoteCriteriaSummary(x);
                }
                return x;
            });
        } else {
            ex = [v];
        }
        acc[key] = {
            property: key,
            behavior: include ? 'include' : 'exclude',
        };
        return acc;
    }, {});

    const {shadowBanned} = authorOpts;

    if (shadowBanned !== undefined) {
        try {
            // @ts-ignore
            await item.author.fetch();
            // user is not shadowbanned
            // if criteria specifies they SHOULD be shadowbanned then return false now
            if (shadowBanned) {
                propResultsMap.shadowBanned!.found = false;
                propResultsMap.shadowBanned!.passed = false;
            }
        } catch (err: any) {
            if (isStatusError(err) && err.statusCode === 404) {
                // user is shadowbanned
                // if criteria specifies they should not be shadowbanned then return false now
                if (!shadowBanned) {
                    propResultsMap.shadowBanned!.found = true;
                    propResultsMap.shadowBanned!.passed = false;
                }
            } else {
                throw err;
            }
        }
    }



    if (propResultsMap.shadowBanned === undefined || propResultsMap.shadowBanned.passed === undefined) {
        try {
            const authorName = getActivityAuthorName(item.author);

            const keys = Object.keys(propResultsMap) as (keyof AuthorCriteria)[]

            let shouldContinue = true;
            for (const k of keys) {
                if (k === 'shadowBanned') {
                    // we have already taken care of this with shadowban check above
                    continue;
                }

                const authorOptVal = definedAuthorOpts[k];

                //if (authorOpts[k] !== undefined) {
                switch (k) {
                    case 'name':
                        const nameVal = authorOptVal as RequiredAuthorCrit['name'];
                        const authPass = () => {

                            for (const n of nameVal) {
                                if (n.toLowerCase() === authorName.toLowerCase()) {
                                    return true;
                                }
                            }
                            return false;
                        }
                        const authResult = authPass();
                        propResultsMap.name!.found = authorName;
                        propResultsMap.name!.passed = !((include && !authResult) || (!include && authResult));
                        if (!propResultsMap.name!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'flairCssClass':
                        const css = await item.author_flair_css_class;
                        const cssPass = () => {
                            // @ts-ignore
                            for (const c of authorOpts[k]) {
                                if (c === css) {
                                    return true;
                                }
                            }
                            return false;
                        }
                        const cssResult = cssPass();
                        propResultsMap.flairCssClass!.found = css;
                        propResultsMap.flairCssClass!.passed = !((include && !cssResult) || (!include && cssResult));
                        if (!propResultsMap.flairCssClass!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'flairText':
                        const text = await item.author_flair_text;
                        const textPass = () => {
                            // @ts-ignore
                            for (const c of authorOpts[k]) {
                                if (c === text) {
                                    return true;
                                }
                            }
                            return false;
                        };
                        const textResult = textPass();
                        propResultsMap.flairText!.found = text;
                        propResultsMap.flairText!.passed = !((include && !textResult) || (!include && textResult));
                        if (!propResultsMap.flairText!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'flairTemplate':
                        const templateId = await item.author_flair_template_id;
                        const templatePass = () => {
                            // @ts-ignore
                            for (const c of authorOpts[k]) {
                                if (c === templateId) {
                                    return true;
                                }
                            }
                            return false;
                        };
                        const templateResult = templatePass();
                        propResultsMap.flairTemplate!.found = templateId;
                        propResultsMap.flairTemplate!.passed = !((include && !templateResult) || (!include && templateResult));
                        if (!propResultsMap.flairTemplate!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'isMod':
                        const mods: RedditUser[] = await item.subreddit.getModerators();
                        const isModerator = mods.some(x => x.name === authorName) || authorName.toLowerCase() === 'automoderator';
                        const modMatch = authorOpts.isMod === isModerator;
                        propResultsMap.isMod!.found = isModerator;
                        propResultsMap.isMod!.passed = !((include && !modMatch) || (!include && modMatch));
                        if (!propResultsMap.isMod!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'age':
                        const authorAge = dayjs.unix(await item.author.created);
                        const ageTest = compareDurationValue(parseDurationComparison(await authorOpts.age as string), authorAge);
                        propResultsMap.age!.found = authorAge.fromNow(true);
                        propResultsMap.age!.passed = !((include && !ageTest) || (!include && ageTest));
                        if (!propResultsMap.age!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'linkKarma':
                        // @ts-ignore
                        const tk = await item.author.total_karma as number;
                        const lkCompare = parseGenericValueOrPercentComparison(await authorOpts.linkKarma as string);
                        let lkMatch;
                        if (lkCompare.isPercent) {

                            lkMatch = comparisonTextOp(item.author.link_karma / tk, lkCompare.operator, lkCompare.value / 100);
                        } else {
                            lkMatch = comparisonTextOp(item.author.link_karma, lkCompare.operator, lkCompare.value);
                        }
                        propResultsMap.linkKarma!.found = tk;
                        propResultsMap.linkKarma!.passed = !((include && !lkMatch) || (!include && lkMatch));
                        if (!propResultsMap.linkKarma!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'commentKarma':
                        // @ts-ignore
                        const ck = await item.author.total_karma as number;
                        const ckCompare = parseGenericValueOrPercentComparison(await authorOpts.commentKarma as string);
                        let ckMatch;
                        if (ckCompare.isPercent) {
                            ckMatch = comparisonTextOp(item.author.comment_karma / ck, ckCompare.operator, ckCompare.value / 100);
                        } else {
                            ckMatch = comparisonTextOp(item.author.comment_karma, ckCompare.operator, ckCompare.value);
                        }
                        propResultsMap.commentKarma!.found = ck;
                        propResultsMap.commentKarma!.passed = !((include && !ckMatch) || (!include && ckMatch));
                        if (!propResultsMap.commentKarma!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'totalKarma':
                        // @ts-ignore
                        const totalKarma = await item.author.total_karma as number;
                        const tkCompare = parseGenericValueComparison(await authorOpts.totalKarma as string);
                        if (tkCompare.isPercent) {
                            throw new SimpleError(`'totalKarma' value on AuthorCriteria cannot be a percentage`);
                        }
                        const tkMatch = comparisonTextOp(totalKarma, tkCompare.operator, tkCompare.value);
                        propResultsMap.totalKarma!.found = totalKarma;
                        propResultsMap.totalKarma!.passed = !((include && !tkMatch) || (!include && tkMatch));
                        if (!propResultsMap.totalKarma!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'verified':
                        const verified = await item.author.has_verified_mail;
                        const vMatch = verified === authorOpts.verified as boolean;
                        propResultsMap.verified!.found = verified;
                        propResultsMap.verified!.passed = !((include && !vMatch) || (!include && vMatch));
                        if (!propResultsMap.verified!.passed) {
                            shouldContinue = false;
                        }
                        break;
                    case 'description':
                        // @ts-ignore
                        const desc = await item.author.subreddit?.display_name.public_description;
                        const dVals = authorOpts[k] as string[];
                        let passed = false;
                        let passReg;
                        for (const val of dVals) {
                            let reg = parseStringToRegex(val, 'i');
                            if (reg === undefined) {
                                reg = parseStringToRegex(`/.*${escapeRegex(val.trim())}.*/`, 'i');
                                if (reg === undefined) {
                                    throw new SimpleError(`Could not convert 'description' value to a valid regex: ${authorOpts[k] as string}`);
                                }
                            }
                            if (reg.test(desc)) {
                                passed = true;
                                passReg = reg.toString();
                                break;
                            }
                        }
                        propResultsMap.description!.found = typeof desc === 'string' ? truncateStringToLength(50)(desc) : desc;
                        propResultsMap.description!.passed = !((include && !passed) || (!include && passed));
                        if (!propResultsMap.description!.passed) {
                            shouldContinue = false;
                        } else {
                            propResultsMap.description!.reason = `Matched with: ${passReg as string}`;
                        }
                        break;
                    case 'userNotes':
                        const notes = await userNotes.getUserNotes(item.author);
                        let foundNoteResult: string[] = [];
                        const notePass = () => {
                            for (const noteCriteria of authorOpts[k] as UserNoteCriteria[]) {
                                const {count = '>= 1', search = 'current', type} = noteCriteria;
                                const {
                                    value,
                                    operator,
                                    isPercent,
                                    extra = ''
                                } = parseGenericValueOrPercentComparison(count);
                                const order = extra.includes('asc') ? 'ascending' : 'descending';
                                switch (search) {
                                    case 'current':
                                        if (notes.length > 0) {
                                            const currentNoteType = notes[notes.length - 1].noteType;
                                            foundNoteResult.push(`Current => ${currentNoteType}`);
                                            if (currentNoteType === type) {
                                                return true;
                                            }
                                        } else {
                                            foundNoteResult.push('No notes present');
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
                                            if (isPercent) {
                                                throw new SimpleError(`When comparing UserNotes with 'consecutive' search 'count' cannot be a percentage. Given: ${count}`);
                                            }
                                            foundNoteResult.push(`Found ${currCount} ${type} consecutively`);
                                            if (comparisonTextOp(currCount, operator, value)) {
                                                return true;
                                            }
                                        }
                                        break;
                                    case 'total':
                                        const filteredNotes = notes.filter(x => x.noteType === type);
                                        if (isPercent) {
                                            // avoid divide by zero
                                            const percent = notes.length === 0 ? 0 : filteredNotes.length / notes.length;
                                            foundNoteResult.push(`${formatNumber(percent)}% are ${type}`);
                                            if (comparisonTextOp(percent, operator, value / 100)) {
                                                return true;
                                            }
                                        } else {
                                            foundNoteResult.push(`${filteredNotes.length} are ${type}`);
                                            if (comparisonTextOp(notes.filter(x => x.noteType === type).length, operator, value)) {
                                                return true;
                                            }
                                        }
                                        break;
                                }
                            }
                            return false;
                        }
                        const noteResult = notePass();
                        propResultsMap.userNotes!.found = foundNoteResult.join(' | ');
                        propResultsMap.userNotes!.passed = !((include && !noteResult) || (!include && noteResult));
                        if (!propResultsMap.userNotes!.passed) {
                            shouldContinue = false;
                        }
                        break;
                }
                //}
                if (!shouldContinue) {
                    break;
                }
            }
        } catch (err: any) {
            if (isStatusError(err) && err.statusCode === 404) {
                throw new SimpleError('Reddit returned a 404 while trying to retrieve User profile. It is likely this user is shadowbanned.');
            } else {
                throw err;
            }
        }
    }

    // gather values and determine overall passed
    const propResults = Object.values(propResultsMap);
    const passed = propResults.filter(x => typeof x.passed === 'boolean').every(x => x.passed === true);

    return {
        behavior: include ? 'include' : 'exclude',
        criteria: authorOpts,
        propertyResults: propResults,
        passed,
    };
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
