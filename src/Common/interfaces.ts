/**
 * An ISO 8601 Duration
 * @pattern ^(-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$
 * */
export type ISO8601 = string;
export type ActivityWindowType = DurationVal | number | ActivityWindowCriteria;
export type DurationVal = ISO8601 | DurationObject;

/**
 * If both criteria are defined then whichever is met first will be used
 *
 * EX 100 count, 90 days
 *
 * * If 90 days of activities = 40 activities => returns 40 activities
 * * If 100 activities is only 20 days => 100 activities
 * @minProperties 1
 * @additionalProperties false
 * */
export interface ActivityWindowCriteria {
    /**
     * The number of activities (submission/comments) to consider
     * @examples [15]
     * */
    count?: number,
    /**
     * An [ISO 8601 duration](https://en.wikipedia.org/wiki/ISO_8601#Durations) or [Day.js duration object](https://day.js.org/docs/en/durations/creating).
     *
     * The duration will be subtracted from the time when the rule is run to create a time range like this:
     *
     * endTime = NOW  <----> startTime = (NOW - duration)
     *
     * EX endTime = 3:00PM <----> startTime = (NOW - 15 minutes) = 2:45PM -- so look for activities between 2:45PM and 3:00PM
     * @examples ["PT1M", {"minutes": 15}]
     * */
    duration?: DurationVal
}

/**
 * A Day.js duration object
 *
 * https://day.js.org/docs/en/durations/creating
 * @minProperties 1
 * @additionalProperties false
 * */
export interface DurationObject {
    /**
     * @examples [15]
     * */
    seconds?: number
    /**
     * @examples [50]
     * */
    minutes?: number
    /**
     * @examples [4]
     * */
    hours?: number
    /**
     * @examples [7]
     * */
    days?: number
    /**
     * @examples [2]
     * */
    weeks?: number
    /**
     * @examples [3]
     * */
    months?: number
    /**
     * @examples [0]
     * */
    years?: number
}


export const windowExample: ActivityWindowType[] = [
    15,
    'PT1M',
    {
        count: 10
    },
    {
        duration: {
            hours: 5
        }
    },
    {
        count: 5,
        duration: {
            minutes: 15
        }
    }
];


export interface ActivityWindow {
    /**
     * Criteria for defining what set of activities should be considered.
     *
     * The value of this property may be either count OR duration -- to use both write it as an ActivityWindowCriteria
     *
     * See ActivityWindowCriteria for descriptions of what count/duration do
     * @examples require('./interfaces.ts').windowExample
     * @default 15
     */
    window?: ActivityWindowType,
}

export interface ReferenceSubmission {
    /**
     * If activity is a Submission and is a link (not self-post) then only look at Submissions that contain this link, otherwise consider all activities.
     * @default true
     * */
    useSubmissionAsReference?: boolean,
}

export interface RichContent {
    /**
     * The Content to submit for this Action. Content is interpreted as reddit-flavored Markdown.
     *
     * If value starts with `wiki:` then the proceeding value will be used to get a wiki page
     *
     * EX `wiki:botconfig/mybot` tries to get `https://reddit.com/mySubredditExample/wiki/botconfig/mybot`
     *
     * EX `this is plain text` => "this is plain text"
     *
     * EX `this is **bold** markdown text` => "this is **bold** markdown text"
     *
     * @examples ["This is the content of a comment/report/usernote", "this is **bold** markdown text", "wiki:botconfig/acomment" ]
     * */
    content?: string,
}

export interface RequiredRichContent extends RichContent {
    content: string
}

/**
 * A list of subreddits (case-insensitive) to look for. Do not include "r/" prefix.
 *
 * EX to match against /r/mealtimevideos and /r/askscience use ["mealtimevideos","askscience"]
 * @examples ["mealtimevideos","askscience"]
 * @minItems 1
 * */
export type SubredditList = string[];

export interface SubredditCriteria {
    /**
     * A list of subreddits (case-insensitive) to look for. Do not include "r/" prefix.
     *
     * EX to match against /r/mealtimevideos and /r/askscience use ["mealtimevideos","askscience"]
     * @examples [["mealtimevideos","askscience"]]
     * @minItems 2
     * */
    subreddits: string[]
}

export type JoinOperands = 'OR' | 'AND';

export interface JoinCondition {
    /**
     * Under what condition should a set of run `Rule` objects be considered "successful"?
     *
     * If `OR` then **any** triggered `Rule` object results in success.
     *
     * If `AND` then **all** `Rule` objects must be triggered to result in success.
     *
     * @default "AND"
     * @examples ["AND"]
     * */
    condition?: JoinOperands,
}

/**
 * You may specify polling options independently for submissions/comments
 * */
export interface PollingOptions {
    /**
     * Polling options for submission events
     * */
    submissions?: {
        /**
         * The number of submissions to pull from /r/subreddit/new on every request
         * @default 10
         * @examples [10]
         * */
        limit?: number,
        /**
         * Amount of time, in milliseconds, to wait between requests to /r/subreddit/new
         *
         * @default 10000
         * @examples [10000]
         * */
        interval?: number,
    },
    /**
     * Polling options for comment events
     * */
    comments?: {
        /**
         * The number of new comments to pull on every request
         * @default 10
         * @examples [10]
         * */
        limit?: number,
        /**
         * Amount of time, in milliseconds, to wait between requests for new comments
         *
         * @default 10000
         * @examples [10000]
         * */
        interval?: number,
    }
}

export interface SubredditCacheConfig {
    /**
     * Amount of time, in milliseconds, author activities (Comments/Submission) should be cached
     * @examples [10000]
     * @default 10000
     * */
    authorTTL?: number;
    /**
     * Amount of time, in milliseconds, wiki content pages should be cached
     * @examples [300000]
     * @default 300000
     * */
    wikiTTL?: number;

    /**
     * Amount of time, in milliseconds, [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) should be cached
     * @examples [60000]
     * @default 60000
     * */
    userNotesTTL?: number;
}

export interface ManagerOptions {
    polling?: PollingOptions

    /**
     * Per-subreddit config for caching TTL values. If set to `false` caching is disabled.
     * */
    caching?: false | SubredditCacheConfig

    /**
     * Use this option to override the `dryRun` setting for all `Checks`
     *
     * @default undefined
     * */
    dryRun?: boolean;
}

export interface ThresholdCriteria {
    /**
     * The number or percentage to trigger this criteria at
     *
     * * If `threshold` is a `number` then it is the absolute number of items to trigger at
     * * If `threshold` is a `string` with percentage (EX `40%`) then it is the percentage of the total this item must reach to trigger
     *
     * @default 10%
     * @examples ["10%", 15]
     * */
    threshold: number | string

    /**
     * @examples [">",">=","<","<="]
     * */
    condition: '>' | '>=' | '<' | '<='
}

export interface ChecksActivityState {
    itemIs?: TypedActivityStates
}

export interface ActivityState {
    removed?: boolean
    locked?: boolean
    spam?: boolean
    stickied?: boolean
    distinguished?: boolean
    approved?: boolean
}

/**
 * Different attributes a `Submission` can be in. Only include a property if you want to check it.
 * */
export interface SubmissionState extends ActivityState {
    pinned?: boolean
    spoiler?: boolean
    /**
     * NSFW
     * */
    over_18?: boolean
    is_self?: boolean
}

/**
 * Different attributes a `Comment` can be in. Only include a property if you want to check it.
 * */
export interface CommentState extends ActivityState {
    /*
    * Is this Comment Author also the Author of the Submission this comment is in?
    * */
    op?: boolean
}

export type TypedActivityStates = SubmissionState[] | CommentState[];
