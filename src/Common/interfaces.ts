import {Duration} from "dayjs/plugin/duration";
import {Cache} from 'cache-manager';
import {MESSAGE} from 'triple-beam';
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import RedditUser from "snoowrap/dist/objects/RedditUser";
import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {MongoConnectionOptions} from "typeorm/driver/mongodb/MongoConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {Connection} from "typeorm";
import {AuthorCriteria, AuthorOptions} from "../Author/Author";
import {JsonOperatorConfigDocument, YamlOperatorConfigDocument} from "./Config/Operator";
import {ConsoleTransportOptions} from "winston/lib/winston/transports";
import {DailyRotateFileTransportOptions} from "winston-daily-rotate-file";
import {DuplexTransportOptions} from "winston-duplex/dist/DuplexTransport";
import {CommentCheckJson, SubmissionCheckJson} from "../Check";
import {SafeDictionary} from "ts-essentials";
import {RuleResultEntity} from "./Entities/RuleResultEntity";
import {Logger} from "winston";
import {SubredditResources} from "../Subreddit/SubredditResources";

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
     * **A `string` consisting of a value and a [Day.js](https://day.js.org/docs/en/durations/creating) time unit** ([test your value](https://regexr.com/61em3))
     *
     * * EX `9 days` => Range is `NOW <---> 9 days ago`
     *
     * **A [Day.js](https://day.js.org/docs/en/durations/creating) `object`**
     *
     * * EX `{"days": 90, "minutes": 15}` => Range is `NOW <---> 90 days and 15 minutes ago`
     *
     * **An [ISO 8601 duration](https://en.wikipedia.org/wiki/ISO_8601#Durations) `string`** ([test your value](https://regexr.com/61em9))
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
     * EX `{"count": 100, duration: "90 days"}`:
     * * If 90 days of activities = 40 activities => returns 40 activities
     * * If 100 activities is only 20 days => 100 activities
     *
     * **If `all` then both criteria must be met.**
     *
     * Effectively, whichever criteria produces the most Activities...
     *
     * EX `{"count": 100, duration: "90 days"}`:
     * * If at 90 days of activities => 40 activities, continue retrieving results until 100 => results in >90 days of activities
     * * If at 100 activities => 20 days of activities, continue retrieving results until 90 days => results in >100 activities
     *
     * @examples ["any"]
     * @default any
     * */
    satisfyOn?: 'any' | 'all';

    /**
     * Filter which subreddits (case-insensitive) Activities are retrieved from.
     *
     * **Note:** Filtering occurs **before** `duration/count` checks are performed.
     * */
    subreddits?: {
        /**
         * Include only results from these subreddits
         *
         * @examples [["mealtimevideos","askscience"]]
         * */
        include?: string[],
        /**
         * Exclude any results from these subreddits
         *
         * **Note:** `exclude` is ignored if `include` is present
         *
         * @examples [["mealtimevideos","askscience"]]
         * */
        exclude?: string[],
    }
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

/**
 * When comparing submissions detect if the reference submission is an image and do a pixel-comparison to other detected image submissions.
 *
 * **Note:** This is an **experimental feature**
 * */
export interface ImageDetection {
    /**
     * Is image detection enabled?
     * */
    enable?: boolean
    /**
     * Determines how and when to check if a URL is an image
     *
     * **Note:** After fetching a URL the **Content-Type** is validated to contain `image` before detection occurs
     *
     * **When `extension`:** (default)
     *
     * * Only URLs that end in known image extensions (.png, .jpg, etc...) are fetched
     *
     * **When `unknown`:**
     *
     * * URLs that end in known image extensions (.png, .jpg, etc...) are fetched
     * * URLs with no extension or unknown (IE non-video, non-doc, etc...) are fetched
     *
     * **When `all`:**
     *
     * * All submissions that have URLs (non-self) will be fetched, regardless of extension
     * * **Note:** This can be bandwidth/CPU intensive if history window is large so use with care
     *
     * @default "extension"
     * */
    fetchBehavior?: 'extension' | 'unknown' | 'all',
    /**
     * The percentage, as a whole number, of difference between two images at which point they will not be considered the same.
     *
     * Will be used as `hash.hardThreshold` and `pixel.threshold` if those values are not specified
     *
     * Default is `5`
     *
     * @default 5
     * */
    threshold?: number

    /**
     * Use perceptual hashing (blockhash-js) to compare images
     *
     * Pros:
     *
     * * very fast
     * * low cpu/memory usage
     * * results can be cached
     *
     * Cons:
     *
     * * not as accurate as pixel comparison
     * * weaker for text-heavy images
     * * mostly color-blind
     *
     * Best uses:
     *
     * * Detecting (general) duplicate images
     * * Comparing large number of images
     * */
    hash?: {
        /**
         * Enabled by default.
         *
         * If both `hash` and `pixel` are enabled then `pixel` will be used to verify image comparison when hashes matches
         *
         * @default true
         * */
        enable?: boolean

        /**
         * Bit count determines accuracy of hash and granularity of hash comparison (comparison to other hashes)
         *
         * Default is `32`
         *
         * **NOTE:** Hashes of different sizes (bits) cannot be compared. If you are caching results make sure all rules where results may be shared use the same bit count to ensure hashes can be compared. Otherwise hashes will be recomputed.
         *
         * @default 32
         * */
        bits?: number

        /**
         * Number of seconds to cache image hash
         * */
        ttl?: number
        /**
         * High Confidence Threshold
         *
         * If the difference in comparison is equal to or less than this number the images are considered the same and pixel comparison WILL NOT occur
         *
         * Defaults to the parent-level `threshold` value if not present
         *
         * Use `null` if you want pixel comparison to ALWAYS occur (softThreshold must be present)
         * */
        hardThreshold?: number | null
        /**
         * Low Confidence Threshold -- only used if `pixel` is enabled
         *
         * If the difference in comparison is
         *
         * 1) equal to or less than this value and
         * 2) the value is greater than `hardThreshold`
         *
         * the images will be compared using the `pixel` method
         * */
        softThreshold?: number
    }

    /**
     * Use pixel counting to compare images
     *
     * Pros:
     *
     * * most accurate
     * * strong with text or color-only changes
     *
     * Cons:
     *
     * * much slower than hashing
     * * memory/cpu intensive
     *
     * Best uses:
     *
     * * Comparison text-only images
     * * Comparison requires high degree of accuracy or changes are subtle
     * */
    pixel?: {
        /**
         * Disabled by default.
         *
         * @default false
         * */
        enable?: boolean
        /**
         * The percentage, as a whole number, of pixels that are **different** between the two images at which point the images are not considered the same.
         * */
        threshold?: number
    }
}

export interface StrongImageDetection {
    enable: boolean,
    fetchBehavior: 'extension' | 'unknown' | 'all'
    threshold: number,
    hash: {
        enable: boolean
        bits: number
        ttl?: number
        hardThreshold: number | null
        softThreshold?: number
    }
    pixel: {
        enable: boolean
        threshold: number
    }
}

// export interface ImageData {
//     data: Promise<Buffer>,
//     buf?: Buffer,
//     width: number,
//     height: number
//     pixels?: number
//     url: string
//     variants?: ImageData[]
// }

export interface ImageComparisonResult {
    isSameDimensions: boolean
    dimensionDifference: {
        width: number;
        height: number;
    };
    misMatchPercentage: number;
    analysisTime: number;
}

export interface RichContent {
    /**
     * The Content to submit for this Action. Content is interpreted as reddit-flavored Markdown.
     *
     * If value starts with `wiki:` then the proceeding value will be used to get a wiki page from the current subreddit
     *
     *  * EX `wiki:botconfig/mybot` tries to get `https://reddit.com/r/currentSubreddit/wiki/botconfig/mybot`
     *
     * If the value starts with `wiki:` and ends with `|someValue` then `someValue` will be used as the base subreddit for the wiki page
     *
     * * EX `wiki:replytemplates/test|ContextModBot` tries to get `https://reddit.com/r/ContextModBot/wiki/replytemplates/test`
     *
     * If the value starts with `url:` then the value is fetched as an external url and expects raw text returned
     *
     * * EX `url:https://pastebin.com/raw/38qfL7mL` tries to get the text response of `https://pastebin.com/raw/38qfL7mL`
     *
     * If none of the above is used the value is treated as the raw context
     *
     *  * EX `this is **bold** markdown text` => "this is **bold** markdown text"
     *
     * All Content is rendered using [mustache](https://github.com/janl/mustache.js/#templates) to enable [Action Templating](https://github.com/FoxxMD/context-mod#action-templating).
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
 * A list of subreddits (case-insensitive) to look for.
 *
 * EX ["mealtimevideos","askscience"]
 * @examples ["mealtimevideos","askscience"]
 * @minItems 1
 * */
export type SubredditList = string[];

export interface SubredditCriteria {
    /**
     * A list of Subreddits (by name, case-insensitive) to look for.
     *
     * EX ["mealtimevideos","askscience"]
     * @examples [["mealtimevideos","askscience"]]
     * @minItems 1
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

export type PollOn = 'unmoderated' | 'modqueue' | 'newSub' | 'newComm';

export interface PollingOptionsStrong extends PollingOptions {
    limit: number,
    interval: number,
}

export interface PollingDefaults {
    /**
     * The maximum number of Activities to get on every request
     * @default 50
     * @examples [50]
     * */
    limit?: number

    /**
     * Amount of time, in seconds, to wait between requests
     *
     * @default 30
     * @examples [30]
     * */
    interval?: number,

    /**
     * Delay processing Activity until it is `N` seconds old
     *
     * Useful if there are other bots that may process an Activity and you want this bot to run first/last/etc.
     *
     * If the Activity is already `N` seconds old when it is initially retrieved no refresh of the Activity occurs (no API request is made) and it is immediately processed.
     *
     * */
    delayUntil?: number,
}

/**
 * A configuration for where, how, and when to poll Reddit for Activities to process
 *
 * @examples [{"pollOn": "unmoderated","limit": 25, "interval": 20000}]
 * */
export interface PollingOptions extends PollingDefaults {

    /**
     * What source to get Activities from. The source you choose will modify how the bots behaves so choose carefully.
     *
     * ### unmoderated (default)
     *
     * Activities that have yet to be approved/removed by a mod. This includes all modqueue (reports/spam) **and new submissions**.
     *
     * Use this if you want the bot to act like a regular moderator and act on anything that can be seen from mod tools.
     *
     * **Note:** Does NOT include new comments, only comments that are reported/filtered by Automoderator. If you want to process all unmoderated AND all new comments then use some version of `polling: ["unmoderated","newComm"]`
     *
     * ### modqueue
     *
     * Activities requiring moderator review, such as reported things and items caught by the spam filter.
     *
     * Use this if you only want the Bot to process reported/filtered Activities.
     *
     * ### newSub
     *
     * Get only `Submissions` that show up in `/r/mySubreddit/new`
     *
     * Use this if you want the bot to process Submissions only when:
     *
     * * they are not initially filtered by Automoderator or
     * * after they have been manually approved from modqueue
     *
     * ### newComm
     *
     * Get only new `Comments`
     *
     * Use this if you want the bot to process Comments only when:
     *
     * * they are not initially filtered by Automoderator or
     * * after they have been manually approved from modqueue
     *
     * */
    pollOn: 'unmoderated' | 'modqueue' | 'newSub' | 'newComm'
}

export interface TTLConfig {
    /**
     * Amount of time, in seconds, author activity history (Comments/Submission) should be cached
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * * ENV => `AUTHOR_TTL`
     * * ARG => `--authorTTL <sec>`
     * @examples [60]
     * @default 60
     * */
    authorTTL?: number | boolean;
    /**
     * Amount of time, in seconds, wiki content pages should be cached
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * @examples [300]
     * @default 300
     * */
    wikiTTL?: number | boolean;
    /**
     * Amount of time, in seconds, [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) should be cached
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * @examples [300]
     * @default 300
     * */
    userNotesTTL?: number | boolean;
    /**
     * Amount of time, in seconds, a submission should be cached
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * @examples [60]
     * @default 60
     * */
    submissionTTL?: number | boolean;
    /**
     * Amount of time, in seconds, a comment should be cached
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * @examples [60]
     * @default 60
     * */
    commentTTL?: number | boolean;
    /**
     * Amount of time, in seconds, a subreddit (attributes) should be cached
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * @examples [600]
     * @default 600
     * */
    subredditTTL?: number | boolean;
    /**
     * Amount of time, in seconds, to cache filter criteria results (`authorIs` and `itemIs` results)
     *
     * This is especially useful if when polling high-volume comments and your checks rely on author/item filters
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * @examples [60]
     * @default 60
     * */
    filterCriteriaTTL?: number | boolean;

    /**
     * Amount of time, in seconds, an Activity that the bot has acted on or created will be ignored if found during polling
     *
     * This is useful to prevent the bot from checking Activities it *just* worked on or a product of the checks. Examples:
     *
     * * Ignore comments created through an Action
     * * Ignore Activity polled from modqueue that the bot just reported
     *
     * This value should be at least as long as the longest polling interval for modqueue/newComm
     *
     * * If `0` or `true` will cache indefinitely (not recommended)
     * * If `false` will not cache
     *
     * @examples [50]
     * @default 50
     * */
    selfTTL?: number | boolean
}

export interface CacheConfig extends TTLConfig {
    /**
     * The cache provider and, optionally, a custom configuration for that provider
     *
     * If not present or `null` provider will be `memory`.
     *
     * To specify another `provider` but use its default configuration set this property to a string of one of the available providers: `memory`, `redis`, or `none`
     * */
    provider?: CacheProvider | CacheOptions

    /**
     * The **maximum** number of Events that the cache should store triggered result summaries for
     *
     * These summaries are viewable through the Web UI.
     *
     * The value specified by a subreddit cannot be larger than the value set by the Operator for the global/bot config (if set)
     *
     * @default 25
     * @example [25]
     * */
    actionedEventsMax?: number
}

export interface OperatorCacheConfig extends CacheConfig {
    /**
     * The **default** number of Events that the cache will store triggered result summaries for
     *
     * These summaries are viewable through the Web UI.
     *
     * The value specified cannot be larger than `actionedEventsMax` for the global/bot config (if set)
     *
     * @default 25
     * @example [25]
     * */
    actionedEventsDefault?: number
}

export type DatabaseDriver = 'sqljs' | 'mysql' | 'mariadb' | 'mongodb' | 'postgres';
export type DatabaseConfig = SqljsConnectionOptions | MysqlConnectionOptions | MongoConnectionOptions | PostgresConnectionOptions;

export interface Footer {
    /**
     * Customize the footer for Actions that send replies (Comment/Ban)
     *
     * If `false` no footer is appended
     *
     * If `string` the value is rendered as markdown or will use `wiki:` parser the same way `content` properties on Actions are rendered with [templating](https://github.com/FoxxMD/context-mod#action-templating).
     *
     * If footer is `undefined` (not set) the default footer will be used:
     *
     * > *****
     * > This action was performed by [a bot.] Mention a moderator or [send a modmail] if you any ideas, questions, or concerns about this action.
     *
     * *****
     *
     * The following properties are available for [templating](https://github.com/FoxxMD/context-mod#action-templating):
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
    /**
     * An array of sources to process Activities from
     *
     * Values in the array may be either:
     *
     * **A `string` representing the `pollOn` value to use**
     *
     * One of:
     *
     * * `unmoderated`
     * * `modqueue`
     * * `newSub`
     * * `newComm`
     *
     * with the rest of the `PollingOptions` properties as defaults
     *
     * **A `PollingOptions` object**
     *
     * If you want to specify non-default properties
     *
     * ****
     * If not specified the default is `["unmoderated"]`
     *
     * @default [["unmoderated"]]
     * @example [["unmoderated","newComm"]]
     * */
    polling?: (string | PollingOptions)[]

    queue?: {
        /**
         * The maximum number of events that can be processed simultaneously.
         *
         * **Do not modify this setting unless you know what you are doing.** The default of `1` is suitable for the majority of use-cases.
         *
         * Raising the max above `1` could be useful if you require very fast response time to short bursts of high-volume events. However logs may become unreadable as many events are processed at the same time. Additionally, any events that depend on past actions from your bot may not be processed correctly given the concurrent nature of this use case.
         *
         * **Note:** Max workers are also enforced at the operator level so a subreddit cannot raise their max above what is specified by the operator.
         *
         * @default 1
         * @minimum 1
         * @examples [1]
         * */
        maxWorkers?: number
    }

    /**
     * Per-subreddit config for caching TTL values. If set to `false` caching is disabled.
     * */
    caching?: CacheConfig

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
     * If `string` the value is rendered as markdown or will use `wiki:` parser the same way `content` properties on Actions are rendered with [templating](https://github.com/FoxxMD/context-mod#action-templating).
     *
     * If footer is `undefined` (not set) the default footer will be used:
     *
     * > *****
     * > This action was performed by [a bot.] Mention a moderator or [send a modmail] if you any ideas, questions, or concerns about this action.
     *
     * *****
     *
     * The following properties are available for [templating](https://github.com/FoxxMD/context-mod#action-templating):
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

    /*
    * An alternate identifier to use in logs to identify your subreddit
    *
    * If your subreddit has a very long name it can make logging unwieldy. Specify a shorter name here to make log statements more readable (and shorter)
    * @example ["shortName"]
    * */
    nickname?: string

    notifications?: NotificationConfig

    credentials?: ThirdPartyCredentialsJsonConfig

    /**
     * Set the default filter criteria for all checks. If this property is specified it will override any defaults passed from the bot's config
     *
     * Default behavior is to exclude all mods and automoderator from checks
     * */
    filterCriteriaDefaults?: FilterCriteriaDefaults

    /**
     * Set the default post-check behavior for all checks. If this property is specified it will override any defaults passed from the bot's config
     *
     * Default behavior is:
     *
     * * postFail => next
     * * postTrigger => nextRun
     * */
    postCheckBehaviorDefaults?: PostBehavior
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
 * A duration and how to compare it against a value
 *
 * The syntax is `(< OR > OR <= OR >=) <number> <unit>` EX `> 100 days`, `<= 2 months`
 *
 * * EX `> 100 days` => Passes if the date being compared is before 100 days ago
 * * EX `<= 2 months` => Passes if the date being compared is after or equal to 2 months
 *
 * Unit must be one of [DayJS Duration units](https://day.js.org/docs/en/durations/creating)
 *
 * [See] https://regexr.com/609n8 for example
 *
 * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(days|weeks|months|years|hours|minutes|seconds|milliseconds)\s*$
 * */
export type DurationComparor = string;

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
    filtered?: boolean
    deleted?: boolean
    locked?: boolean
    spam?: boolean
    stickied?: boolean
    distinguished?: boolean
    approved?: boolean
    score?: CompareValue
    /**
     * A string containing a comparison operator and a value to compare against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>`
     *
     * * EX `> 2`  => greater than 2 total reports
     *
     * Defaults to TOTAL reports on an Activity. Suffix the value with the report type to check that type:
     *
     * * EX `> 3 mod` => greater than 3 mod reports
     * * EX `>= 1 user` => greater than 1 user report
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    reports?: CompareValue
    age?: DurationComparor
    /**
     * Test whether the activity is present in dispatched/delayed activities
     *
     * NOTE: This is DOES NOT mean that THIS activity is from dispatch -- just that it exists there. To test whether THIS activity is from dispatch use `source`
     *
     * * `true` => activity exists in delayed activities
     * * `false` => activity DOES NOT exist in delayed activities
     * * `string` => activity exists in delayed activities with given identifier
     * * `string[]` => activity exists in delayed activities with any of the given identifiers
     *
     * */
    dispatched?: boolean | string | string[]


    // can use ActivitySource | ActivitySource[] here because of issues with generating json schema, see ActivitySource comments
    /**
     * Test where the current activity was sourced from.
     *
     * A source can be any of:
     *
     * * `poll` => activity was retrieved from polling a queue (unmoderated, modqueue, etc...)
     * * `poll:[pollSource]` => activity was retrieved from specific polling source IE `poll:unmoderated` activity comes from unmoderated queue
     *   * valid sources: unmoderated modqueue newComm newSub
     * * `dispatch` => activity is from Dispatch Action
     * * `dispatch:[identifier]` => activity is from Dispatch Action with specific identifier
     * * `user` => activity was from user input (web dashboard)
     *
     * */
    source?: string | string[]
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
    /**
     * A valid regular expression to match against the title of the submission
     * */
    title?: string

    /**
     * * If `true` then passes if flair has ANY text
     * * If `false` then passes if flair has NO text
     * */
    link_flair_text?: boolean | string | string[]
    /**
     * * If `true` then passes if flair has ANY css
     * * If `false` then passes if flair has NO css
     * */
    link_flair_css_class?: boolean | string | string[]
    /**
     * * If `true` then passes if there is ANY flair template id
     * * If `false` then passes if there is NO flair template id
     * */
    flairTemplate?: boolean | string | string[]
    /**
     * Is the submission a reddit-hosted image or video?
     * */
    isRedditMediaDomain?: boolean
}

// properties calculated/derived by CM -- not provided as plain values by reddit
export const cmActivityProperties = ['submissionState','score','reports','removed','deleted','filtered','age','title'];

/**
 * Different attributes a `Comment` can be in. Only include a property if you want to check it.
 * @examples [{"op": true, "removed": false}]
 * */
export interface CommentState extends ActivityState {
    /**
     * Is this Comment Author also the Author of the Submission this comment is in?
     * */
    op?: boolean
    /**
     * A list of SubmissionState attributes to test the Submission this comment is in
     * */
    submissionState?: SubmissionState[]

    /**
     * The (nested) level of a comment.
     *
     * * 0 mean the comment is at top-level (replying to submission)
     * * non-zero, Nth value means the comment has N parent comments
     * */
    depth?: DurationComparor
}

/**
 * Different attributes a `Subreddit` can be in. Only include a property if you want to check it.
 * @examples [{"over18": true}]
 * */
export interface SubredditState {
    /**
     * Is subreddit quarantined?
     * */
    quarantine?: boolean
    /**
     * Is subreddit NSFW/over 18?
     *
     * **Note**: This is **mod-controlled flag** so it is up to the mods of the subreddit to correctly mark their subreddit as NSFW
     * */
    over18?: boolean
    /**
     * The name the subreddit.
     *
     * Can be a normal string (will check case-insensitive) or a regular expression
     *
     * EX `["mealtimevideos", "/onlyfans*\/i"]`
     *
     * @examples ["mealtimevideos", "/onlyfans*\/i"]
     * */
    name?: string | RegExp
    /**
     * A friendly description of what this State is trying to parse
     * */
    stateDescription?: string

    isUserProfile?: boolean
}

export interface StrongSubredditState extends SubredditState {
    name?: RegExp
}

export type TypedActivityState = SubmissionState | CommentState;

export type TypedActivityStates = TypedActivityState[];

export interface DomainInfo {
    display: string,
    domain: string,
    aliases: string[],
    provider?: string,
    mediaType?: string
}

export const DEFAULT_POLLING_INTERVAL = 30;
export const DEFAULT_POLLING_LIMIT = 50;

export type Invokee = 'system' | 'user';
export const SYSTEM = 'system';
export const USER = 'user';
export type RunState = 'running' | 'paused' | 'stopped';
export const STOPPED = 'stopped';
export const RUNNING = 'running';
export const PAUSED = 'paused';

export interface SearchAndReplaceRegExp {
    /**
     * The search value to test for
     *
     * Can be a normal string (converted to a case-sensitive literal) or a valid regular expression
     *
     * EX `["find this string", "/some string*\/ig"]`
     *
     * @examples ["find this string", "/some string*\/ig"]
     * */
    search: string

    /**
     * The replacement string/value to use when search is found
     *
     * This can be a literal string like `'replace with this`, an empty string to remove the search value (`''`), or a special regex value
     *
     * See replacement here for more information: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace
     * */
    replace: string
}

export interface NamedGroup {
    [name: string]: string
}

export interface GlobalRegExResult {
    match: string,
    groups: string[],
    named: NamedGroup | undefined
}

export interface RegExResult {
    matched: boolean,
    matches: string[],
    global: GlobalRegExResult[]
}

type LogLevel = "error" | "warn" | "info" | "verbose" | "debug";

export type LogConsoleOptions = Pick<ConsoleTransportOptions, 'silent' | 'eol' | 'stderrLevels' | 'consoleWarnLevels'> & {
    level?: LogLevel
}

export type LogFileOptions = Omit<DailyRotateFileTransportOptions, 'stream' | 'handleRejections' | 'options' | 'handleExceptions' | 'format' | 'log' | 'logv' | 'close' | 'dirname'> & {
    level?: LogLevel
    /**
     * The absolute path to a directory where rotating log files should be stored.
     *
     * * If not present or `null` or `false` no log files will be created
     * * If `true` logs will be stored at `[working directory]/logs`
     *
     * * ENV => `LOG_DIR`
     * * ARG => `--logDir [dir]`
     *
     * @examples ["/var/log/contextmod"]
     * */
    dirname?: string | boolean | null
}

// export type StrongFileOptions = LogFileOptions & {
//     dirname?: string
// }

export type LogStreamOptions = Omit<DuplexTransportOptions, 'name' | 'stream' | 'handleRejections' | 'handleExceptions' | 'format' | 'log' | 'logv' | 'close'> & {
    level?: LogLevel
}

export interface LoggingOptions  {
    /**
     * The minimum log level to output. The log level set will output logs at its level **and all levels above it:**
     *
     *  * `error`
     *  * `warn`
     *  * `info`
     *  * `verbose`
     *  * `debug`
     *
     *  Note: `verbose` will display *a lot* of information on the status/result of run rules/checks/actions etc. which is very useful for testing configurations. Once your bot is stable changing the level to `info` will reduce log noise.
     *
     *  * ENV => `LOG_LEVEL`
     *  * ARG => `--logLevel <level>`
     *
     *  @default "verbose"
     *  @examples ["verbose"]
     * */
    level?: LogLevel,
    /**
     * **DEPRECATED** - Use `file.dirname` instead
     * The absolute path to a directory where rotating log files should be stored.
     *
     * * If not present or `null` or `false` no log files will be created
     * * If `true` logs will be stored at `[working directory]/logs`
     *
     * * ENV => `LOG_DIR`
     * * ARG => `--logDir [dir]`
     *
     * @examples ["/var/log/contextmod"]
     * @deprecated
     * @see logging.file.dirname
     * */
    path?: string | boolean | null

    /**
     * Options for Rotating File logging
     * */
    file?: LogFileOptions
    /**
     * Options for logging to api/web
     * */
    stream?: LogStreamOptions
    /**
     * Options for logging to console
     * */
    console?: LogConsoleOptions
}

export type StrongLoggingOptions = Required<Pick<LoggingOptions, 'stream' | 'console' | 'file'>> & {
    level?: LogLevel
};

export type LoggerFactoryOptions = StrongLoggingOptions & {
    additionalTransports?: any[]
    defaultLabel?: string
}
/**
 * Available cache providers
 * */
export type CacheProvider = 'memory' | 'redis' | 'none';

// export type StrongCache = SubredditCacheConfig & {
//     provider: CacheOptions
// }
export type StrongCache = {
    authorTTL: number | boolean,
    userNotesTTL: number | boolean,
    wikiTTL: number | boolean,
    submissionTTL: number | boolean,
    commentTTL: number | boolean,
    subredditTTL: number | boolean,
    selfTTL: number | boolean,
    filterCriteriaTTL: number | boolean,
    provider: CacheOptions
    actionedEventsMax?: number,
    actionedEventsDefault: number,
}

/**
 * Configure granular settings for a cache provider with this object
 * */
export interface CacheOptions {
    store: CacheProvider,
    /**
     * (`redis`) hostname
     *
     * @default "localhost"
     * @examples ["localhost"]
     * */
    host?: string | undefined,
    /**
     * (`redis`) port to connect on
     *
     * @default 6379
     * @examples [6379]
     * */
    port?: number | undefined,
    /**
     * (`redis`) the authentication passphrase (if enabled)
     * */
    auth_pass?: string | undefined,
    /**
     * (`redis`) the db number to use
     *
     * @default 0
     * @examples [0]
     * */
    db?: number | undefined,
    /**
     * The default TTL, in seconds, for the cache provider.
     *
     * Can mostly be ignored since TTLs are defined for each cache object
     *
     * @default 60
     * @examples [60]
     * */
    ttl?: number,
    /**
     * (`memory`) The maximum number of keys (unique cache calls) to store in cache
     *
     * When the maximum number of keys is reached the cache will being dropping the [least-recently-used](https://github.com/isaacs/node-lru-cache) key to keep the cache at `max` size.
     *
     * This will determine roughly how large in **RAM** each `memory` cache can be, based on how large your `window` criteria are. Consider this example:
     *
     * * all `window` criteria in a subreddit's rules are `"window": 100`
     * * `"max": 500`
     * * Maximum size of **each** memory cache will be `500 x 100 activities = 50,000 activities`
     *   * So the shared cache would be max 50k activities and
     *   * Every additional private cache (when a subreddit configures their cache separately) will also be max 50k activities
     *
     * @default 500
     * @examples [500]
     * */
    max?: number

    [key:string]: any
}

export type NotificationProvider = 'discord';

export type NotificationEventType = 'runStateChanged' | 'pollingError' | 'eventActioned' | 'configUpdated'

export interface NotificationEventPayload  {
    type: NotificationEventType,
    title: string
    body?: string
    causedBy?: string
    logLevel?: string
}

export interface NotificationProviderConfig {
    name: string
    type: NotificationProvider
}

export interface DiscordProviderConfig extends NotificationProviderConfig {
    url: string
}

export type NotificationProviders = DiscordProviderConfig;

export interface NotificationEventConfig {
    types: NotificationEventType[]
    providers: string[]
}

export interface NotificationContent {
    logLevel?: string
    title: string
    body?: string
    footer?: string
}

export type NotificationEvents = (NotificationEventType[] | NotificationEventConfig)[];

export interface NotificationConfig {
    /**
     * A list of notification providers (Discord, etc..) to configure. Each object in the list is one provider. Multiple of the same provider can be provided but must have different names
     * */
    providers: NotificationProviders[],
    events: NotificationEvents
}

export interface Notifier {
    name: string
    type: string;
    handle: Function
}

export interface ManagerStateChangeOption {
    reason?: string
    suppressNotification?: boolean
    suppressChangeEvent?: boolean
}

/**
 * Configuration required to connect to a CM Server
 * */
export interface BotConnection {
    /**
     * The hostname and port the CM Server is listening on EX `localhost:8085`
     * */
    host: string
    /**
     * The **shared secret** used to sign API calls from the Client to the Server.
     *
     * This value should be the same as what is specified in the target CM's `api.secret` configuration
     * */
    secret: string
}

/**
 * Credentials required for the bot to interact with Reddit's API
 *
 * These credentials will provided to both the API and Web interface unless otherwise specified with the `web.credentials` property
 *
 * Refer to the [required credentials table](https://github.com/FoxxMD/context-mod/blob/master/docs/operatorConfiguration.md#minimum-required-configuration) to see what is necessary to run the bot.
 *
 * @examples [{"clientId": "f4b4df1_9oiu", "clientSecret": "34v5q1c564_yt7", "redirectUri": "http://localhost:8085/callback", "refreshToken": "34_f1w1v4", "accessToken": "p75_1c467b2"}]
 * */
export interface RedditCredentials {
    /**
     * Client ID for your Reddit application
     *
     * * ENV => `CLIENT_ID`
     * * ARG => `--clientId <id>`
     *
     * @examples ["f4b4df1c7b2"]
     * */
    clientId?: string,
    /**
     * Client Secret for your Reddit application
     *
     * * ENV => `CLIENT_SECRET`
     * * ARG => `--clientSecret <id>`
     *
     * @examples ["34v5q1c56ub"]
     * */
    clientSecret?: string,

    /**
     * Access token retrieved from authenticating an account with your Reddit Application
     *
     * * ENV => `ACCESS_TOKEN`
     * * ARG => `--accessToken <token>`
     *
     * @examples ["p75_1c467b2"]
     * */
    accessToken?: string,
    /**
     * Refresh token retrieved from authenticating an account with your Reddit Application
     *
     * * ENV => `REFRESH_TOKEN`
     * * ARG => `--refreshToken <token>`
     *
     * @examples ["34_f1w1v4"]
     * */
    refreshToken?: string
}

/**
 * Separate credentials for the web interface can be provided when also running the api.
 *
 * All properties not specified will default to values given in ENV/ARG credential properties
 *
 * Refer to the [required credentials table](https://github.com/FoxxMD/context-mod/blob/master/docs/operatorConfiguration.md#minimum-required-configuration) to see what is necessary for the web interface.
 *
 * @examples [{"clientId": "f4b4df1_9oiu", "clientSecret": "34v5q1c564_yt7", "redirectUri": "http://localhost:8085/callback"}]
 * */
export interface WebCredentials {
    /**
     * Client ID for your Reddit application
     *
     * @examples ["f4b4df1_9oiu"]
     * */
    clientId?: string,
    /**
     * Client Secret for your Reddit application
     *
     * @examples ["34v5q1c564_yt7"]
     * */
    clientSecret?: string,
    /**
     * Redirect URI for your Reddit application
     *
     * Used for:
     *
     * * accessing the web interface for monitoring bots
     * * authenticating an account to use for a bot instance
     *
     * * ENV => `REDIRECT_URI`
     * * ARG => `--redirectUri <uri>`
     *
     * @examples ["http://localhost:8085/callback"]
     * */
    redirectUri?: string,
}

export interface SnoowrapOptions {
    /**
     * Proxy all requests to Reddit's API through this endpoint
     *
     * * ENV => `PROXY`
     * * ARG => `--proxy <proxyEndpoint>`
     *
     * @examples ["http://localhost:4443"]
     * */
    proxy?: string,
    /**
     * Manually set the debug status for snoowrap
     *
     * When snoowrap has `debug: true` it will log the http status response of reddit api requests to at the `debug` level
     *
     * * Set to `true` to always output
     * * Set to `false` to never output
     *
     * If not present or `null` will be set based on `logLevel`
     *
     * * ENV => `SNOO_DEBUG`
     * * ARG => `--snooDebug`
     * */
    debug?: boolean,

    /**
     * Set the maximum number of times snoowrap will retry a request if it encounters one of the codes specified in either retryErrorCodes or timeoutCodes
     *
     * Each retry attempt is delayed by an exponential falloff timer
     *
     * @default 2
     * @examples [2]
     * */
    maxRetryAttempts?: number

    /**
     * Specify the HTTP Status codes that should be valid for retrying a request
     *
     * Defaults: 502, 503, 504, 522
     *
     * @default [502, 503, 504, 522]
     * */
    retryErrorCodes?: number[]

    /**
     * Specify the error codes that should be valid for retrying a request.
     *
     * These are used to make snoowrap retry if a request times out or reddit's api response times out -- which happens occasionally for no reason.
     *
     * You most likely do not need to change these. However, if you want snoowrap to always fail on a network issue set this to an empty array
     *
     * Defaults: 'ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNRESET'
     *
     * @default ['ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNRESET']
     * */
    timeoutCodes?: string[]
}

export type FilterCriteriaDefaultBehavior = 'replace' | 'merge';

export interface FilterCriteriaDefaults {
    itemIs?: TypedActivityStates
    /**
     * Determine how itemIs defaults behave when itemIs is present on the check
     *
     * * merge => adds defaults to check's itemIs
     * * replace => check itemIs will replace defaults (no defaults used)
     * */
    itemIsBehavior?: FilterCriteriaDefaultBehavior
    /**
     * Determine how authorIs defaults behave when authorIs is present on the check
     *
     * * merge => merges defaults with check's authorIs
     * * replace => check authorIs will replace defaults (no defaults used)
     * */
    authorIs?: AuthorOptions
    authorIsBehavior?: FilterCriteriaDefaultBehavior
}

export interface SubredditOverrides {
    name: string
    flowControlDefaults?: {
        maxGotoDepth?: number
    }
}

/**
 * The configuration for an **individual reddit account** ContextMod will run as a bot.
 *
 * Multiple bot configs may be specified (one per reddit account).
 *
 * **NOTE:** If `bots` is not specified in a `FILE` then a default `bot` is generated using `ENV/ARG` values IE `CLIENT_ID`, etc...but if `bots` IS specified the default is not generated.
 *
 * */
export interface BotInstanceJsonConfig {
    credentials?: BotCredentialsJsonConfig | RedditCredentials
    /*
    * The name to display for the bot. If not specified will use the name of the reddit account IE `u/TheBotName`
    * */
    name?: string
    /**
     * Settings to configure 3rd party notifications for when behavior occurs
     * */
    notifications?: NotificationConfig

    /**
     * Settings to control some [Snoowrap](https://github.com/not-an-aardvark/snoowrap) behavior.
     *
     * Overrides any defaults provided at top-level operator config.
     *
     * Set to an empty object to "ignore" any top-level config
     * */
    snoowrap?: SnoowrapOptions

    /**
     * Define the default behavior for all filter criteria on all checks in all subreddits
     *
     * Defaults to exclude mods and automoderator from checks
     * */
    filterCriteriaDefaults?: FilterCriteriaDefaults

    postCheckBehaviorDefaults?: PostBehavior

    flowControlDefaults?: {
        maxGotoDepth?: number
    }

    /**
     * Settings related to bot behavior for subreddits it is managing
     * */
    subreddits?: {
        /**
         * Names of subreddits for bot to run on
         *
         * If not present or `null` bot will run on all subreddits it is a moderator of
         *
         * * ENV => `SUBREDDITS` (comma-separated)
         * * ARG => `--subreddits <list...>`
         *
         * @examples [["mealtimevideos","programminghumor"]]
         * */
        names?: string[]

        /**
         * Names of subreddits the bot should NOT run, based on what subreddits it moderates
         *
         * This setting is ignored if `names` is specified
         *
         * @examples [["mealtimevideos","programminghumor"]]
         * */
        exclude?: string[]
        /**
         * If `true` then all subreddits will run in dry run mode, overriding configurations
         *
         * * ENV => `DRYRUN`
         * * ARG => `--dryRun`
         *
         * @default false
         * @examples [false]
         * */
        dryRun?: boolean
        /**
         * The default relative url to the ContextMod wiki page EX `https://reddit.com/r/subreddit/wiki/<path>`
         *
         * * ENV => `WIKI_CONFIG`
         * * ARG => `--wikiConfig <path>`
         *
         * @default "botconfig/contextbot"
         * @examples ["botconfig/contextbot"]
         * */
        wikiConfig?: string
        /**
         * Interval, in seconds, to perform application heartbeat
         *
         * On heartbeat the application does several things:
         *
         * * Log output with current api rate remaining and other statistics
         * * Tries to retrieve and parse configurations for any subreddits with invalid configuration state
         * * Restarts any bots stopped/paused due to polling issues, general errors, or invalid configs (if new config is valid)
         *
         * * ENV => `HEARTBEAT`
         * * ARG => `--heartbeat <sec>`
         *
         * @default 300
         * @examples [300]
         * */
        heartbeatInterval?: number,

        overrides?: SubredditOverrides[]
    }

    /**
     *  Settings related to default polling configurations for subreddits
     * */
    polling?: PollingDefaults & {
        /**
         * DEPRECATED: See `shared`
         *
         *  Using the ENV or ARG will sett `unmoderated` and `modqueue` on `shared`
         *
         * * ENV => `SHARE_MOD`
         * * ARG => `--shareMod`
         *
         * @default false
         * @deprecated
         * */
        sharedMod?: boolean,

        /**
         * Set which polling sources should be shared among subreddits using default polling settings for that source
         *
         * * For `unmoderated and `modqueue` the bot will poll on **r/mod** for new activities
         * * For `newSub` and `newComm` all subreddits sharing the source will be combined to poll like **r/subreddit1+subreddit2/new**
         *
         * If set to `true` all polling sources will be shared,  otherwise specify which sourcs should be shared as a list
         *
         * */
        shared?: PollOn[] | true,

        /**
         * If sharing a stream staggers pushing relevant Activities to individual subreddits.
         *
         * Useful when running many subreddits and rules are potentially cpu/memory/traffic heavy -- allows spreading out load
         * */
        stagger?: number,
    }

    /**
     * Settings related to default configurations for queue behavior for subreddits
     * */
    queue?: {
    /**
     * Set the number of maximum concurrent workers any subreddit can use.
     *
     * Subreddits may define their own number of max workers in their config but the application will never allow any subreddit's max workers to be larger than the operator
     *
     * NOTE: Do not increase this unless you are certain you know what you are doing! The default is suitable for the majority of use cases.
     *
     * @default 1
     * @examples [1]
     * */
    maxWorkers?: number,
    }

    /**
     * Settings to configure the default caching behavior for this bot
     *
     * Every setting not specified will default to what is specified by the global operator caching config
     * */
    caching?: OperatorCacheConfig
    /**
     * Settings related to managing heavy API usage.
     * */
    nanny?: {
        /**
         * When `api limit remaining` reaches this number the application will attempt to put heavy-usage subreddits in a **slow mode** where activity processed is slowed to one every 1.5 seconds until the api limit is reset.
         *
         * @default 250
         * @examples [250]
         * */
        softLimit?: number,
        /**
         * When `api limit remaining` reaches this number the application will pause all event polling until the api limit is reset.
         *
         * @default 50
         * @examples [50]
         * */
        hardLimit?: number,
    }
}

/**
 * Configuration for application-level settings IE for running the bot instance
 *
 * * To load a JSON configuration **from the command line** use the `-c` cli argument EX: `node src/index.js -c /path/to/JSON/config.json`
 * * To load a JSON configuration **using an environmental variable** use `OPERATOR_CONFIG` EX: `OPERATOR_CONFIG=/path/to/JSON/config.json`
 * */
export interface OperatorJsonConfig {
    /**
     * Mode to run ContextMod in
     *
     * * `all` (default) - Run the api and the web interface
     * * `client` - Run web interface only
     * * `server` - Run the api/bots only
     *
     * @default "all"
     * */
    mode?: 'server' | 'client' | 'all',
    /**
     * Settings related to the user(s) running this ContextMod instance and information on the bot
     * */
    operator?: {
        /**
         * The name, or names, of the Reddit accounts, without prefix, that the operators of this bot uses.
         *
         * This is used for showing more information in the web interface IE show all logs/subreddits if even not a moderator.
         *
         * EX -- User is /u/FoxxMD then `"name": ["FoxxMD"]`
         *
         * * ENV => `OPERATOR` (if list, comma-delimited)
         * * ARG => `--operator <name...>`
         *
         * @examples [["FoxxMD","AnotherUser"]]
         * */
        name?: string | string[],
        /**
         * A **public** name to display to users of the web interface. Use this to help moderators using your bot identify who is the operator in case they need to contact you.
         *
         * Leave undefined for no public name to be displayed.
         *
         * * ENV => `OPERATOR_DISPLAY`
         * * ARG => `--operatorDisplay <name>`
         *
         * @examples ["Moderators of r/MySubreddit"]
         * */
        display?: string,
    },
    /**
     * Settings to configure 3rd party notifications for when ContextMod behavior occurs
     * */
    notifications?: NotificationConfig
    /**
     * Settings to configure global logging defaults
     * */
    logging?: LoggingOptions,

    /**
     * Settings to configure the default caching behavior globally
     *
     * These settings will be used by each bot, and subreddit, that does not specify their own
     * */
    caching?: OperatorCacheConfig

    /**
     * Database backend to use for persistent data
     *
     * Defaults to 'sqljs' which stores data in a file
     * */
    databaseConfig?: {
        connection?: DatabaseDriver | DatabaseConfig,
        migrations?: DatabaseMigrationOptions
    }

    /**
     * Set global snoowrap options as well as default snoowrap config for all bots that don't specify their own
     * */
    snoowrap?: SnoowrapOptions

    bots?: BotInstanceJsonConfig[]

    /**
     * Added to the User-Agent information sent to reddit
     *
     * This string will be added BETWEEN version and your bot name.
     *
     * EX: `myBranch` => `web:contextMod:v1.0.0-myBranch:BOT-/u/MyBotUser`
     *
     * * ENV => `USER_AGENT`
     * */
    userAgent?: string

    /**
     * Settings for the web interface
     * */
    web?: {
        /**
         * The port for the web interface
         *
         * * ENV => `PORT`
         * * ARG => `--port <number>`
         *
         * @default 8085
         * @examples [8085]
         * */
        port?: number,

        /**
         * Caching provider to use for session and invite data
         *
         * If none is provided the top-level caching provider is used
         * */
        caching?: 'memory' | 'redis' | CacheOptions
        /**
         * Settings to configure the behavior of user sessions -- the session is what the web interface uses to identify logged in users.
         * */
        session?: {
            /**
             * Number of seconds a session should be valid for.
             *
             * Default is 1 day
             *
             * @default 86400
             * @examples [86400]
             * */
            maxAge?: number
            /**
             * The secret value used to encrypt session data
             *
             * If provider is persistent (`redis`) specifying a value here will ensure sessions are valid between application restarts
             *
             * When not present or `null` a random string is generated on application start
             *
             * @examples ["definitelyARandomString"]
             * */
            secret?: string,
        }

        /**
         * Settings related to oauth flow invites
         * */
        invites?: {
            /**
            * Number of seconds an invite should be valid for
             *
             * If `0` or not specified (default) invites do not expire
            *
            * @default 0
            * @examples [0]
            * */
            maxAge?: number
        }
        /**
         * The default log level to filter to in the web interface
         *
         * If not specified or `null` will be same as global `logLevel`
         * */
        logLevel?: LogLevel,
        /**
         * Maximum number of log statements to keep in memory for each subreddit
         *
         * @default 200
         * @examples [200]
         * */
        maxLogs?: number,
        /**
         * A list of CM Servers this Client should connect to.
         *
         * If not specified a default `BotConnection` for this instance is generated
         *
         * @examples [[{"host": "localhost:8095", "secret": "aRandomString"}]]
         * */
        clients?: BotConnection[]

        credentials?: WebCredentials

        /**
         * The name, or names, of the Reddit accounts, without prefix, that the operators of this **web interface** uses.
         *
         * **Note:** This is **not the same** as the top-level `operator` property. This allows specified users to see the status of all `clients` but **not** access to them -- that must still be specified in the `operator.name` property in the configuration of each bot.
         *
         *
         * EX -- User is /u/FoxxMD then `"name": ["FoxxMD"]`
         *
         * @examples [["FoxxMD","AnotherUser"]]
         * */
        operators?: string[]
    }
    /**
     * Configuration for the **Server** application. See [Architecture Documentation](https://github.com/FoxxMD/context-mod/blob/master/docs/serverClientArchitecture.md) for more info
     * */
    api?: {
        /**
         * The port the server listens on for API requests
         *
         * @default 8095
         * @examples [8095]
         * */
        port?: number,
        /**
         * The **shared secret** used to verify API requests come from an authenticated client.
         *
         * Use this same value for the `secret` value in a `BotConnection` object to connect to this Server
         * */
        secret?: string,
        /**
         * A friendly name for this server. This will override `friendly` in `BotConnection` if specified.
         * */
        friendly?: string,
    }

    credentials?: ThirdPartyCredentialsJsonConfig
}

export interface RequiredOperatorRedditCredentials extends RedditCredentials {
    clientId: string,
    clientSecret: string
}

export interface RequiredWebRedditCredentials extends RedditCredentials {
    clientId: string,
    clientSecret: string
    redirectUri: string
}

export interface ThirdPartyCredentialsJsonConfig {
    youtube?: {
        apiKey: string
    }
    [key: string]: any
}

export interface BotCredentialsJsonConfig extends ThirdPartyCredentialsJsonConfig {
    reddit: RedditCredentials
}

export interface BotCredentialsConfig extends ThirdPartyCredentialsJsonConfig {
    reddit: RequiredOperatorRedditCredentials
}

export interface BotInstanceConfig extends BotInstanceJsonConfig {
    credentials: BotCredentialsJsonConfig
    database: Connection
    snoowrap: SnoowrapOptions
    subreddits: {
        names?: string[],
        exclude?: string[],
        dryRun?: boolean,
        wikiConfig: string,
        heartbeatInterval: number,
        overrides?: SubredditOverrides[]
    },
    polling: {
        shared: PollOn[],
        stagger?: number,
        limit: number,
        interval: number,
    },
    queue: {
        maxWorkers: number,
    },
    caching: StrongCache,
    nanny: {
        softLimit: number,
        hardLimit: number,
    }
    userAgent?: string
}

export interface OperatorConfig extends OperatorJsonConfig {
    mode: 'all' | 'server' | 'client',
    operator: {
        name: string[]
        display?: string,
    },
    notifications?: NotificationConfig
    logging: StrongLoggingOptions,
    caching: StrongCache,
    databaseConfig: {
        connection: DatabaseConfig,
        migrations: DatabaseMigrationOptions
    }
    database: Connection
    web: {
        port: number,
        caching: CacheOptions,
        session: {
            maxAge: number,
            secret: string,
        },
        invites: {
          maxAge: number
        },
        logLevel?: LogLevel,
        maxLogs: number,
        clients: BotConnection[]
        credentials: RequiredWebRedditCredentials
        operators: string[]
    }
    api: {
        port: number,
        secret: string,
        friendly?: string,
    }
    bots: BotInstanceConfig[]
    credentials: ThirdPartyCredentialsJsonConfig
}

export interface OperatorFileConfig {
    document: YamlOperatorConfigDocument | JsonOperatorConfigDocument
    isWriteable?: boolean
}

export interface OperatorConfigWithFileContext extends OperatorConfig {
    fileConfig: OperatorFileConfig
}

//export type OperatorConfig = Required<OperatorJsonConfig>;

interface CacheTypeStat {
    requests: number,
    miss: number,
    missPercent?: string,
    identifierRequestCount: Cache
    identifierAverageHit: number | string
    requestTimestamps: number[]
    averageTimeBetweenHits: string
}

export interface ResourceStats {
    [key: string]: CacheTypeStat;
}

export interface LogInfo {
    message: string
    [MESSAGE]: string,
    level: string
    timestamp: string
    subreddit?: string
    instance?: string
    labels?: string[]
    bot?: string
    user?: string
}

export interface ActionResult extends ActionProcessResult {
    premise: ObjectPremise
    kind: string,
    name: string,
    run: boolean,
    runReason?: string,
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
}

export interface ActionProcessResult {
    success: boolean,
    dryRun: boolean,
    result?: string
    touchedEntities?: (Submission | Comment | RedditUser | string)[]
}

export interface EventActivity {
    peek: string
    link: string
    type: ActivityType
    id: string
    subreddit: string
    author: string
}

export interface ActionedEvent {
    activity: EventActivity
    parentSubmission?: EventActivity
    timestamp: number
    subreddit: string,
    triggered: boolean,
    runResults: RunResult[]
    dispatchSource?: ActivitySourceData
}

export interface ResultContext {
    result?: string
    data?: any
}

export interface RuleResult extends ResultContext {
    premise: ObjectPremise
    kind: string
    name: string
    triggered: (boolean | null)
    fromCache?: boolean
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
}

export type FormattedRuleResult = RuleResult & {
    triggered: string
    result: string
}

export interface RuleSetResult {
    results: RuleResultEntity[],
    condition: 'OR' | 'AND',
    triggered: boolean
}

export interface CheckResult {
    triggered: boolean
    ruleResults: RuleResultEntity[]
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
    fromCache?: boolean
}

export interface CheckSummary extends CheckResult {
    name: string
    run: string
    postBehavior: string
    error?: string
    actionResults: ActionResult[]
    condition: 'AND' | 'OR'
}

export interface RunResult {
    name: string
    triggered: boolean
    reason?: string
    error?: string
    itemIs?: FilterResult<TypedActivityState>
    authorIs?: FilterResult<AuthorCriteria>
    checkResults: CheckSummary[]
}

export interface UserResultCache {
    result: boolean,
    ruleResults: RuleResultEntity[]
}

export type RedditEntityType = 'user' | 'subreddit';

export interface RedditEntity {
    name: string
    type: RedditEntityType
}

export interface HistoricalStatsDisplay {
    checksRunTotal: number
    checksFromCacheTotal: number
    checksTriggeredTotal: number
    rulesRunTotal: number
    rulesCachedTotal: number
    rulesTriggeredTotal: number
    actionsRunTotal: number
    eventsCheckedTotal: number
    eventsActionedTotal: number
    [index: string]: any
}

export interface ManagerStats {
    eventsAvg: number
    rulesAvg: number
    historical: HistoricalStatsDisplay
    cache: {
        provider: string,
        currentKeyCount: number,
        isShared: boolean,
        totalRequests: number,
        totalMiss: number,
        missPercent: string,
        requestRate: number,
        types: ResourceStats
    },
}

export type SearchFacetType = 'title' | 'url' | 'duplicates' | 'crossposts' | 'external';

export interface RepostItem {
    value: string
    createdOn?: number
    source: string
    sourceUrl?: string
    score?: number
    id: string
    itemType: string
    acquisitionType: SearchFacetType | 'comment'
    sourceObj?: any
    reqSameness?: number
}

export interface RepostItemResult extends RepostItem {
    sameness: number
}

export interface StringComparisonOptions {
    lengthWeight?: number,
    transforms?: ((str: string) => string)[]
}

export interface DatabaseMigrationOptions {
    force?: boolean
}

export interface FilterCriteriaPropertyResult<T> {
    property: keyof T
    found?: string | boolean | number | null | FilterResult<any>
    passed?: null | boolean
    reason?: string
    behavior: FilterBehavior
}

export interface FilterCriteriaResult<T> {
    behavior: FilterBehavior
    criteria: T//AuthorCriteria | TypedActivityStates
    propertyResults: FilterCriteriaPropertyResult<T>[]
    passed: boolean
}

export type FilterBehavior = 'include' | 'exclude'

export interface FilterResult<T> {
    criteriaResults: FilterCriteriaResult<T>[]
    join: JoinOperands
    passed: boolean
}

export interface TextTransformOptions {
    /**
     * A set of search-and-replace operations to perform on text values before performing a match. Transformations are performed in the order they are defined.
     *
     * * If `transformationsActivity` IS NOT defined then these transformations will be performed on BOTH the activity text (submission title or comment) AND the repost candidate text
     * * If `transformationsActivity` IS defined then these transformations are only performed on repost candidate text
     * */
    transformations?: SearchAndReplaceRegExp[]

    /**
     * Specify a separate set of transformations for the activity text (submission title or comment)
     *
     * To perform no transformations when `transformations` is defined set this to an empty array (`[]`)
     * */
    transformationsActivity?: SearchAndReplaceRegExp[]
}

export interface TextMatchOptions {
    /**
     * The percentage, as a whole number, of a repost title/comment that must match the title/comment being checked in order to consider both a match
     *
     * Note: Setting to 0 will make every candidate considered a match -- useful if you want to match if the URL has been reposted anywhere
     *
     * Defaults to `85` (85%)
     *
     * @default 85
     * @example [85]
     * */
    matchScore?: number

    /**
     * The minimum number of words in the activity being checked for which this rule will run on
     *
     * If the word count is below the minimum the rule fails
     *
     * Defaults to 2
     *
     * @default 2
     * @example [2]
     * */
    minWordCount?: number

    /**
     * Should text matching be case sensitive?
     *
     * Defaults to false
     *
     * @default false
     * @example [false]
     **/
    caseSensitive?: boolean
}

export type ActivityCheckJson = SubmissionCheckJson | CommentCheckJson;

export type GotoPath = `goto:${string}`;
/**
 * The possible behaviors that can occur after a check has run
 *
 * * next => continue to next Check/Run
 * * stop => stop CM lifecycle for this activity (immediately end)
 * * nextRun => skip any remaining Checks in this Run and start the next Run
 * * goto:[path] => specify a run[.check] to jump to
 *
 * */
export type PostBehaviorTypes = 'next' | 'stop' | 'nextRun' | string;

export interface PostBehavior {
    /**
     * Do this behavior if a Check is triggered
     *
     * @default nextRun
     * @example ["nextRun"]
     * */
    postTrigger?: PostBehaviorTypes
    /**
     * Do this behavior if a Check is NOT triggered
     *
     * @default next
     * @example ["next"]
     * */
    postFail?: PostBehaviorTypes
}

export type ActivityType = 'submission' | 'comment';

export type FullNameTypes = ActivityType | 'user' | 'subreddit' | 'message';

export type ItemCritPropHelper = SafeDictionary<FilterCriteriaPropertyResult<(CommentState & SubmissionState)>, keyof (CommentState & SubmissionState)>;
export type RequiredItemCrit = Required<(CommentState & SubmissionState)>;

export type onExistingFoundBehavior = 'replace' | 'skip' | 'ignore';

export interface ActivityDispatchConfig {
    identifier?: string
    cancelIfQueued?: boolean | NonDispatchActivitySource | NonDispatchActivitySource[]
    goto?: string
    onExistingFound?: onExistingFoundBehavior
    tardyTolerant?: boolean | DurationVal
    delay: DurationVal
}

export interface ActivityDispatch extends Omit<ActivityDispatchConfig, 'delay'| 'tardyTolerant'> {
    id: string
    queuedAt: number
    activity: Submission | Comment
    delay: number
    tardyTolerant?: boolean | number
    processing: boolean
    action?: string
    type: ActivitySourceTypes
}

export interface ActivitySourceData {
    goto?: string
    queuedAt: number
    action?: string,
    delay?: number,
    type: ActivitySourceTypes
    id: string
    identifier?: string
}

export type ActionTarget = 'self' | 'parent';

export type InclusiveActionTarget = ActionTarget | 'any';

export type DispatchSource = 'dispatch' | `dispatch:${string}`;

export type NonDispatchActivitySource = 'poll' | `poll:${PollOn}` | 'user' | `user:${string}`;

export type ActivitySourceTypes = 'poll' | 'dispatch' | 'user';

// TODO
// https://github.com/YousefED/typescript-json-schema/issues/426
// https://github.com/YousefED/typescript-json-schema/issues/425
// @pattern ^(((poll|dispatch)(:\w+)?)|user)$
// @type string
/**
 * Where an Activity was retrieved from
 *
 * Source can be any of:
 *
 * * `poll` => activity was retrieved from polling a queue (unmoderated, modqueue, etc...)
 * * `poll:[pollSource]` => activity was retrieved from specific polling source IE `poll:unmoderated` activity comes from unmoderated queue
 * * `dispatch` => activity is from Dispatch Action
 * * `dispatch:[identifier]` => activity is from Dispatch Action with specific identifier
 * * `user` => activity was from user input (web dashboard)
 *
 *
 * */
export type ActivitySource = NonDispatchActivitySource | DispatchSource;

export interface ObjectPremise {
    kind: string
    config: object
}

export interface RunnableBaseOptions {
    logger: Logger;
    /**
     * A list of criteria to test the state of the `Activity` against before running the check.
     *
     * If any set of criteria passes the Check will be run. If the criteria fails then the Check will fail.
     *
     * * @examples [[{"over_18": true, "removed': false}]]
     * */
    itemIs?: TypedActivityStates

    /**
     * If present then these Author criteria are checked before running the Check. If criteria fails then the Check will fail.
     * */
    authorIs?: AuthorOptions

    resources: SubredditResources
}

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
