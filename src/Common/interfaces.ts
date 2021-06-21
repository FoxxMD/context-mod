import {Duration} from "dayjs/plugin/duration";

/**
 * An ISO 8601 Duration
 * @pattern ^(-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$
 * */
export type ISO8601 = string;

/**
 * A shorthand value for a DayJS duration consisting of a number value and time unit
 *
 * * EX `9 days`
 * * EX `3 months`
 * @pattern ^\s*(?<time>\d+)\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)\s*$
 * */
export type DayJSShorthand = string;
export type DurationString = DayJSShorthand | ISO8601;

/**
 * A value to define the range of Activities to retrieve.
 *
 * Acceptable values:
 *
 * **`ActivityWindowCriteria` object**
 *
 * Allows specify multiple range properties and more specific behavior
 *
 * **A `number` of Activities to retrieve**
 *
 * * EX `100` => 100 Activities
 *
 * *****
 *
 * Any of the below values that specify the amount of time to subtract from `NOW` to create a time range IE `NOW <---> [duration] ago`
 *
 * Acceptable values:
 *
 * **A `string` consisting of a value and a [Day.js](https://day.js.org/docs/en/durations/creating#list-of-all-available-units) time UNIT**
 *
 * * EX `9 days` => Range is `NOW <---> 9 days ago`
 *
 * **A [Day.js](https://day.js.org/docs/en/durations/creating) `object`**
 *
 * * EX `{"days": 90, "minutes": 15}` => Range is `NOW <---> 90 days and 15 minutes ago`
 *
 * **An [ISO 8601 duration](https://en.wikipedia.org/wiki/ISO_8601#Durations) `string`**
 *
 * * EX `PT15M` => 15 minutes => Range is `NOW <----> 15 minutes ago`
 *
 * @examples ["90 days"]
 * */
export type ActivityWindowType = ActivityWindowCriteria | DurationVal | number;
export type DurationVal = DurationString | DurationObject;

/**
 * Multiple properties that may be used to define what range of Activity to retrieve.
 *
 * May specify one, or both properties along with the `satisfyOn` property, to affect the retrieval behavior.
 *
 * @examples [{"count": 100, "duration": {"days": 90}}]
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
     * A value that specifies the amount of time to subtract from `NOW` to create a time range IE `NOW <---> [duration] ago`
     *
     * Acceptable values:
     *
     * **A `string` consisting of a value and a [Day.js](https://day.js.org/docs/en/durations/creating) time unit**
     *
     * * EX `9 days` => Range is `NOW <---> 9 days ago`
     *
     * **A [Day.js](https://day.js.org/docs/en/durations/creating) `object`**
     *
     * * EX `{"days": 90, "minutes": 15}` => Range is `NOW <---> 90 days and 15 minutes ago`
     *
     * **An [ISO 8601 duration](https://en.wikipedia.org/wiki/ISO_8601#Durations) `string`**
     *
     * * EX `PT15M` => 15 minutes => Range is `NOW <----> 15 minutes ago`
     *
     * @examples ["90 days", "PT15M", {"minutes": 15}]
     * */
    duration?: DurationVal

    /**
     * Define the condition under which both criteria are considered met
     *
     * **If `any` then it will retrieve Activities until one of the criteria is met, whichever occurs first**
     *
     * EX `{count: 100, duration: {days: 90}}`:
     * * If 90 days of activities = 40 activities => returns 40 activities
     * * If 100 activities is only 20 days => 100 activities
     *
     * **If `all` then both criteria must be met.**
     *
     * Effectively, whichever criteria produces the most Activities...
     *
     * EX `{count: 100, duration: {days: 90}}`:
     * * If at 90 days of activities => 40 activities, continue retrieving results until 100 => results in >90 days of activities
     * * If at 100 activities => 20 days of activities, continue retrieving results until 90 days => results in >100 activities
     *
     * @examples ["any"]
     * @default any
     * */
    satisfyOn?: 'any' | 'all';
}

/**
 * A [Day.js duration object](https://day.js.org/docs/en/durations/creating)
 *
 * @examples [{"minutes": 30, "hours": 1}]
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

export interface DurationComparison {
    operator: StringOperator,
    duration: Duration
}

export interface GenericComparison {
    operator: StringOperator,
    value: number,
    isPercent: boolean,
    extra?: string,
    displayText: string,
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
     *  * EX `wiki:botconfig/mybot` tries to get `https://reddit.com/mySubredditExample/wiki/botconfig/mybot`
     *  * EX `this is **bold** markdown text` => "this is **bold** markdown text"
     *
     * Content is rendered using [mustache](https://github.com/janl/mustache.js/#templates) to enable [Action Templating](https://github.com/FoxxMD/reddit-context-bot#action-templating).
     *
     * The following properties are always available in the template (view individual Rules to see rule-specific template data):
     * ```
     * item.kind      => The type of Activity that was checked (comment/submission)
     * item.author    => The name of the Author of the Activity EX FoxxMD
     * item.permalink => A permalink URL to the Activity EX https://reddit.com/r/yourSub/comments/o1h0i0/title_name/1v3b7x
     * item.url       => If the Activity is Link Sumbission then the external URL
     * item.title     => If the Activity is a Submission then the title of that Submission
     * rules          => An object containing RuleResults of all the rules run for this check. See Action Templating for more details on naming
     * ```
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
 * @examples [{"submissions": {"limit": 10, "interval": 10000}, "comments": {"limit": 15, "interval": 10000}}]
 * */
export interface PollingOptions {
    /**
     * Polling options for submission events
     * @examples [{"limit": 10, "interval": 10000}]
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
     * @examples [{"limit": 10, "interval": 10000}]
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

export interface Footer {
    /**
     * Customize the footer for Actions that send replies (Comment/Ban)
     *
     * If `false` no footer is appended
     *
     * If `string` the value is rendered as markdown or will use `wiki:` parser the same way `content` properties on Actions are rendered with [templating](https://github.com/FoxxMD/reddit-context-bot#action-templating).
     *
     * If footer is `undefined` (not set) the default footer will be used:
     *
     * > *****
     * > This action was performed by [a bot.] Mention a moderator or [send a modmail] if you any ideas, questions, or concerns about this action.
     *
     * *****
     *
     * The following properties are available for [templating](https://github.com/FoxxMD/reddit-context-bot#action-templating):
     * ```
     * subName    => name of subreddit Action was performed in (EX 'mealtimevideos')
     * permaLink  => The permalink for the Activity the Action was performed on EX https://reddit.com/r/yourSub/comments/o1h0i0/title_name/1v3b7x
     * modmaiLink => An encoded URL that will open a new message to your subreddit with the Action permalink appended to the body
     * botLink    => A permalink to the FAQ for this bot.
     * ```
     * If you use your own footer or no footer **please link back to the bot FAQ** using the `{{botLink}}` property in your content :)
     *
     * */
    footer?: false | string
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
     * @examples [false,true]
     * */
    dryRun?: boolean;

    /**
     * Customize the footer for Actions that send replies (Comment/Ban). **This sets the default value for all Actions without `footer` specified in their configuration.**
     *
     * If `false` no footer is appended
     *
     * If `string` the value is rendered as markdown or will use `wiki:` parser the same way `content` properties on Actions are rendered with [templating](https://github.com/FoxxMD/reddit-context-bot#action-templating).
     *
     * If footer is `undefined` (not set) the default footer will be used:
     *
     * > *****
     * > This action was performed by [a bot.] Mention a moderator or [send a modmail] if you any ideas, questions, or concerns about this action.
     *
     * *****
     *
     * The following properties are available for [templating](https://github.com/FoxxMD/reddit-context-bot#action-templating):
     * ```
     * subName    => name of subreddit Action was performed in (EX 'mealtimevideos')
     * permaLink  => The permalink for the Activity the Action was performed on EX https://reddit.com/r/yourSub/comments/o1h0i0/title_name/1v3b7x
     * modmaiLink => An encoded URL that will open a new message to your subreddit with the Action permalink appended to the body
     * botLink    => A permalink to the FAQ for this bot.
     * ```
     * If you use your own footer or no footer **please link back to the bot FAQ** using the `{{botLink}}` property in your content :)
     *
     * @default undefined
     * */
    footer?: false | string
}

/**
 * A string containing a comparison operator and a value to compare against
 *
 * The syntax is `(< OR > OR <= OR >=) <number>`
 *
 * * EX `> 100`  => greater than 100
 *
 * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
 * */
export type CompareValue = string;

/**
 * A string containing a comparison operator and a value to compare against
 *
 * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
 *
 * * EX `> 100`  => greater than 100
 * * EX `<= 75%` => less than or equal to 75%
 *
 * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
 * */
export type CompareValueOrPercent = string;

export type StringOperator = '>' | '>=' | '<' | '<=';

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
    condition: StringOperator
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
 * @examples [{"over_18": true, "removed": false}]
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
 * @examples [{"op": true, "removed": false}]
 * */
export interface CommentState extends ActivityState {
    /*
    * Is this Comment Author also the Author of the Submission this comment is in?
    * */
    op?: boolean
}

export type TypedActivityStates = SubmissionState[] | CommentState[];

