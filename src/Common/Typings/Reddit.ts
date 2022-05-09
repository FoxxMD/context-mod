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
