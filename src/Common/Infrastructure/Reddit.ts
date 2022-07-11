import {Comment, Submission} from "snoowrap/dist/objects";

export type ActivityType = 'submission' | 'comment';
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

export interface CachedFetchedActivitiesResult {
    pre: SnoowrapActivity[]
    rawCount: number
    apiCount: number
    preMaxTrigger?: string | null
}

export interface FetchedActivitiesResult extends CachedFetchedActivitiesResult {
    post: SnoowrapActivity[]
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
