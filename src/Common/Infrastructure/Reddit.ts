import {Comment, Submission} from "snoowrap/dist/objects";
import { ValueOf } from "ts-essentials";

export type ActivityType = 'submission' | 'comment';
export type MaybeActivityType = ActivityType | false;
export type FullNameTypes = ActivityType | 'user' | 'subreddit' | 'message';

export interface RedditThing {
    val: string
    type: FullNameTypes
    prefix: string
    id: string
}

export interface PermalinkRedditThings {
    comment?: RedditThing,
    submission?: RedditThing
}

export type AuthorHistorySort = 'new' | 'hot' | 'top' | 'controversial';
export type AuthorHistorySortTime = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
export type AuthorHistoryType = 'comment' | 'submission' | 'overview';
export type SnoowrapActivity = Submission | Comment;

type valueof<T> = T[keyof T]

/*
* Depending on what caching provider is used the results from cache can either be
*
* * full-fat SnoowrapActivities (memory provider keeps everything in memory!)
* * OR json-serialized objects of the data from those activities (all other cache providers)
*
* we don't know which they are until we retrieve them.
* */
export type SnoowrapLike = Record<keyof SnoowrapActivity, valueof<SnoowrapActivity>>;

export interface CachedFetchedActivitiesResult {
    pre: SnoowrapActivity[] | SnoowrapLike[]
    rawCount: number
    apiCount: number
    preMaxTrigger?: string | null
}

export interface FetchedActivitiesResult extends CachedFetchedActivitiesResult {
    post: SnoowrapActivity[]
    pre: SnoowrapActivity[]
}

export type ReportType = 'mod' | 'user';

export interface Report {
    reason: string
    type: ReportType
    author?: string
    snoozed: boolean
    canSnooze: boolean
}

export type RawRedditUserReport = [
    string, // reason
    number, // number of reports with this reason
    boolean, // is report snoozed
    boolean // can the reports be snoozed
];

export type RawRedditModReport = [string, string];

export const activityReports = (activity: SnoowrapActivity): Report[] => {
    const reports: Report[] = [];
    for(const r of (activity.user_reports as unknown as RawRedditUserReport[])) {
        const report = {
            reason: r[0],
            type: 'user' as ReportType,
            snoozed: r[2],
            canSnooze: r[3]
        };
        for(let i = 0; i < r[1]; i++) {
            reports.push(report);
        }
    }

    for(const r of (activity.mod_reports as unknown as RawRedditModReport[])) {
        reports.push({
            reason: r[0],
            type: 'mod' as ReportType,
            author: r[1],
            snoozed: false,
            canSnooze: false
        })
    }
    return reports;
}

export interface RawSubredditRemovalReasonData {
    data: {
        [key: string]: SubredditRemovalReason
    },
    order: [string]
}

export interface SubredditRemovalReason {
    message: string
    id: string,
    title: string
}

export interface SubredditActivityAbsoluteBreakdown {
    count: number
    name: string
}

export interface SubredditActivityBreakdown extends SubredditActivityAbsoluteBreakdown {
    percent: number
}

export interface SubredditActivityBreakdownByType {
    total: SubredditActivityBreakdown[]
    submission: SubredditActivityBreakdown[]
    comment: SubredditActivityBreakdown[]
}
