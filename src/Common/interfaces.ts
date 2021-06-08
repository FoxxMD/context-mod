/**
 * An ISO 8601 Duration
 * @pattern ^(-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$
 * */
export type ISO8601 = string;
export type ActivityWindowType = Duration | number | ActivityWindowCriteria;
export type Duration = ISO8601 | DurationObject;

/**
 * If both properties are defined then the first criteria met will be used IE if # of activities = count before duration is reached then count will be used, or vice versa
 * @minProperties 1
 * @additionalProperties false
 * */
export interface ActivityWindowCriteria {
    /**
     * The number of activities (submission/comments) to consider
     * */
    count?: number,
    /**
     * An ISO 8601 duration or Day.js duration object.
     *
     * The duration will be subtracted from the time when the rule is run to create a time range like this:
     *
     * endTime = NOW  <----> startTime = (NOW - duration)
     *
     * EX endTime = 3:00PM <----> startTime = (NOW - 15 minutes) = 2:45PM -- so look for activities between 2:45PM and 3:00PM
     * @examples ["PT1M", {"minutes": 15}]
     * */
    duration?: Duration
}

/**
 * A Day.js duration object
 *
 * https://day.js.org/docs/en/durations/creating
 * @minProperties 1
 * @additionalProperties false
 * */
export interface DurationObject {
    seconds?: number
    minutes?: number
    hours?: number
    days?: number
    weeks?: number
    months?: number
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
     * If value starts with 'wiki:' then the proceeding value will be used to get a wiki page
     *
     * EX "wiki:botconfig/mybot" tries to get https://reddit.com/mySubredditExample/wiki/botconfig/mybot
     *
     * EX "this is plain text"
     *
     * EX "this is **bold** markdown text"
     *
     * @examples ["this is plain text", "this is **bold** markdown text", "wiki:botconfig/acomment" ]
     * */
    content: string,
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
    subreddits: SubredditList
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
         * */
        limit?: number,
        /**
         * Amount of time, in milliseconds, to wait between requests to /r/subreddit/new
         *
         * @default 10000
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
         * */
        limit?: number,
        /**
         * Amount of time, in milliseconds, to wait between requests for new comments
         *
         * @default 10000
         * */
        interval?: number,
    }
}

export interface ManagerOptions {
    polling?: PollingOptions
    /**
     * If present, time in milliseconds between HEARTBEAT log statements with current api limit count. Nice to have to know things are still ticking if there is low activity
     * */
    heartbeatInterval?: number
    /**
     * When Reddit API limit remaining reaches this number context bot will start warning on every poll interval
     * @default 250
     * */
    apiLimitWarning?: number
}
