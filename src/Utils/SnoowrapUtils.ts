import {Listing, RedditUser} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import Subreddit from "snoowrap/dist/objects/Subreddit";
import {Duration} from "dayjs/plugin/duration";
import dayjs, {Dayjs} from "dayjs";
import Mustache from "mustache";
import he from "he";
import {
    DomainInfo,


} from "../Common/interfaces";
import {
    asStrongSubredditState,
    asSubmission,
    convertSubredditsRawToStrong,
    formatNumber,
    getActivityAuthorName,
    getActivitySubredditName,
    isStrongSubredditState, isSubmission,
    mergeArr,
    normalizeName,
    parseDurationValToDuration,
    parseRedditEntity,
    parseRuleResultsToMarkdownSummary, removeUndefinedKeys,
    subredditStateIsNameOnly,
    toStrongSubredditState,
    truncateStringToLength,
    windowConfigToWindowCriteria
} from "../util";
import UserNotes from "../Subreddit/UserNotes";
import {Logger} from "winston";
import {URL} from "url";
import {isStatusError, MaybeSeriousErrorWithCause, SimpleError} from "./Errors";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {StrongSubredditCriteria, SubredditCriteria} from "../Common/Infrastructure/Filters/FilterCriteria";
import {DurationVal} from "../Common/Infrastructure/Atomic";
import {ActivityWindowCriteria} from "../Common/Infrastructure/ActivityWindow";
import {
    SnoowrapActivity,
    SubredditActivityAbsoluteBreakdown,
    SubredditActivityBreakdown, SubredditActivityBreakdownByType
} from "../Common/Infrastructure/Reddit";

export const BOT_LINK = 'https://www.reddit.com/r/ContextModBot/comments/otz396/introduction_to_contextmodbot';

export interface AuthorTypedActivitiesOptions extends ActivityWindowCriteria {
    type?: 'comment' | 'submission',
}

export const isSubreddit = async (subreddit: Subreddit, stateCriteria: SubredditCriteria | StrongSubredditCriteria, logger?: Logger) => {
    delete stateCriteria.stateDescription;

    if (Object.keys(stateCriteria).length === 0) {
        return true;
    }

    const crit = isStrongSubredditState(stateCriteria) ? stateCriteria : toStrongSubredditState(stateCriteria, {defaultFlags: 'i'});

    const log: Logger | undefined = logger !== undefined ? logger.child({leaf: 'Subreddit Check'}, mergeArr) : undefined;

    return await (async () => {
        for (const k of Object.keys(crit)) {
            // @ts-ignore
            if (crit[k] !== undefined) {
                switch (k) {
                    case 'name':
                        const nameReg = crit[k] as RegExp;
                        if(!nameReg.test(subreddit.display_name)) {
                            return false;
                        }
                        break;
                    case 'isUserProfile':
                        const entity = parseRedditEntity(subreddit.display_name);
                        const entityIsUserProfile = entity.type === 'user';
                        if(crit[k] !== entityIsUserProfile) {

                            if(log !== undefined) {
                                log.debug(`Failed: Expected => ${k}:${crit[k]} | Found => ${k}:${entityIsUserProfile}`)
                            }
                            return false
                        }
                        break;
                    case 'over18':
                    case 'over_18':
                        // handling an edge case where user may have confused Comment/Submission state "over_18" with SubredditState "over18"

                        // @ts-ignore
                        if (crit[k] !== subreddit.over18) {
                            if(log !== undefined) {
                                // @ts-ignore
                                log.debug(`Failed: Expected => ${k}:${crit[k]} | Found => ${k}:${subreddit.over18}`)
                            }
                            return false
                        }
                        break;
                    default:
                        // @ts-ignore
                        if (subreddit[k] !== undefined) {
                            // @ts-ignore
                            if (crit[k] !== subreddit[k]) {
                                if(log !== undefined) {
                                    // @ts-ignore
                                    log.debug(`Failed: Expected => ${k}:${crit[k]} | Found => ${k}:${subreddit[k]}`)
                                }
                                return false
                            }
                        } else {
                            if(log !== undefined) {
                                log.warn(`Tried to test for Subreddit property '${k}' but it did not exist`);
                            }
                        }
                        break;
                }
            }
        }
        if(log !== undefined) {
            log.debug(`Passed: ${JSON.stringify(stateCriteria)}`);
        }
        return true;
    })() as boolean;
}

const renderContentCommentTruncate = truncateStringToLength(50);
const shortTitleTruncate = truncateStringToLength(15);

export const renderContent = async (template: string, data: (Submission | Comment), ruleResults: RuleResultEntity[] = [], usernotes: UserNotes) => {
    const conditional: any = {};
    if(data.can_mod_post) {
        conditional.reports = data.num_reports;
        conditional.modReports = data.mod_reports.length;
        conditional.userReports = data.user_reports.length;
    }
    if(asSubmission(data)) {
        conditional.nsfw = data.over_18;
        conditional.spoiler = data.spoiler;
        conditional.op = true;
        conditional.upvoteRatio = `${data.upvote_ratio * 100}%`;
    } else {
        conditional.op = data.is_submitter;
    }
    const templateData: any = {
        kind: data instanceof Submission ? 'submission' : 'comment',
        // @ts-ignore
        author: getActivityAuthorName(await data.author),
        votes: data.score,
        age: dayjs.duration(dayjs().diff(dayjs.unix(data.created))).humanize(),
        permalink: `https://reddit.com${data.permalink}`,
        botLink: BOT_LINK,
        id: data.name,
        ...conditional
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
        templateData.shortTitle = shortTitleTruncate(data.title);
    } else {
        templateData.title = renderContentCommentTruncate(data.body);
        templateData.shortTitle = shortTitleTruncate(data.body);
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
        if (data.subredditBreakdown !== undefined) {
            // format breakdown for markdown
            if (Array.isArray(data.subredditBreakdown)) {
                const bdArr = data.subredditBreakdown as SubredditActivityBreakdown[];
                data.subredditBreakdownFormatted = formatSubredditBreakdownAsMarkdownList(bdArr);
            } else {
                const bd = data.subredditBreakdown as SubredditActivityBreakdownByType;

                // default to total
                data.subredditBreakdownFormatted = formatSubredditBreakdownAsMarkdownList(bd.total);

                const formatted = Object.entries((bd)).reduce((acc: { [key: string]: string }, curr) => {
                    const [name, breakdownData] = curr;
                    acc[`${name}Formatted`] = formatSubredditBreakdownAsMarkdownList(breakdownData);
                    return acc;
                }, {});
                data.subredditBreakdown = {...bd, ...formatted};
            }
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
        if (asSubmission(item)) {
            // when automod filters a post it gets this category
            return item.banned_at_utc !== null && item.removed_by_category !== 'automod_filtered';
        }
        // when automod filters a comment item.removed === false
        // so if we want to processing filtered comments we need to check for this
        return item.banned_at_utc !== null && item.removed;
    } else {
        if (asSubmission(item)) {
            return item.removed_by_category === 'moderator' || item.removed_by_category === 'deleted';
        }
        // in subreddits the bot does not mod it is not possible to tell the difference between a comment that was removed by the user and one that was removed by a mod
        return item.body === '[removed]';
    }
}

export const activityIsFiltered = (item: Submission | Comment): boolean => {
    if(item.can_mod_post) {
        if (asSubmission(item)) {
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
    if (asSubmission(item)) {
        return item.removed_by_category === 'deleted';
    }
    return item.author.name === '[deleted]'
}

export const getAuthorHistoryAPIOptions = (val: any) => {
    const {
        sort,
        sortTime,
        t,
        limit,
        chunkSize,
        skipReplies
    } = val;

    const opts = removeUndefinedKeys({
        sort,
        t: t ?? sortTime,
        limit: limit ?? chunkSize,
        skipReplies
    });

    return opts;
}

export const getSubredditBreakdown = (activities: SnoowrapActivity[]): SubredditActivityBreakdown[] => {
    const total = activities.length;

    const countBd = activities.reduce((acc: { [key: string]: number }, curr) => {
        const subName = curr.subreddit.display_name;
        if (acc[subName] === undefined) {
            acc[subName] = 0;
        }
        acc[subName]++;

        return acc;
    }, {});

    const breakdown: SubredditActivityBreakdown[] = Object.entries(countBd).reduce((acc, curr) => {
        const [name, count] = curr;
        return acc.concat(
            {
                name,
                count,
                percent: Number.parseFloat(formatNumber((count / total) * 100))
            }
        );
    }, ([] as SubredditActivityBreakdown[]));

    return breakdown;
}

export const getSubredditBreakdownByActivityType = (activities: SnoowrapActivity[]): SubredditActivityBreakdownByType => {

    return {
        total: getSubredditBreakdown(activities),
        submission: getSubredditBreakdown(activities.filter(x => x instanceof Submission)),
        comment: getSubredditBreakdown(activities.filter(x => x instanceof Comment)),
    }
}

export const formatSubredditBreakdownAsMarkdownList = (data: SubredditActivityBreakdown[] = []): string => {
    if(data.length === 0) {
        return '';
    }
    data.sort((a, b) => b.count - a.count);

    const bd = data.map(x => {
        const entity = parseRedditEntity(x.name);
        const prefixedName = entity.type === 'subreddit' ? `r/${entity.name}` : `u/${entity.name}`;
        return `* ${prefixedName} - ${x.count} (${x.percent}%)`
    }).join('\n');

    return `${bd}\n`;
}
