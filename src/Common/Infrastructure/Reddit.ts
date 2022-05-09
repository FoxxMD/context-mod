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
