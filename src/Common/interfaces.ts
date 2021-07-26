import {Duration} from "dayjs/plugin/duration";
import Poll from "snoostorm/out/util/Poll";
import Snoowrap from "snoowrap";

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
     * All Content is rendered using [mustache](https://github.com/janl/mustache.js/#templates) to enable [Action Templating](https://github.com/FoxxMD/reddit-context-bot#action-templating).
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
     * Amount of time, in seconds, author activities (Comments/Submission) should be cached
     * @examples [60]
     * @default 60
     * */
    authorTTL?: number;
    /**
     * Amount of time, in seconds, wiki content pages should be cached
     * @examples [300]
     * @default 300
     * */
    wikiTTL?: number;

    /**
     * Amount of time, in milliseconds, [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) should be cached
     * @examples [300]
     * @default 300
     * */
    userNotesTTL?: number;
}

export interface SubredditCacheConfig extends TTLConfig {
    provider?: CacheProvider | CacheOptions
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

    /**
     * Per-subreddit config for caching TTL values. If set to `false` caching is disabled.
     * */
    caching?: SubredditCacheConfig

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

    /*
    * An alternate identifier to use in logs to identify your subreddit
    *
    * If your subreddit has a very long name it can make logging unwieldy. Specify a shorter name here to make log statements more readable (and shorter)
    * @example ["shortName"]
    * */
    nickname?: string
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
    filtered?: boolean
    deleted?: boolean
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
export type CacheProvider = 'memory' | 'redis' | 'none';

// export type StrongCache = SubredditCacheConfig & {
//     provider: CacheOptions
// }
export type StrongCache = {
    authorTTL: number,
    userNotesTTL: number,
    wikiTTL: number
    provider: CacheOptions
}

export interface CacheOptions {
    store: CacheProvider,
    host?: string | undefined,
    port?: number | undefined,
    auth_pass?: string | undefined,
    db?: number | undefined,
    ttl?: number,
    max?: number
}

export interface OperatorJsonConfig {
    operator?: {
        name?: string,
        display?: string,
    },
    credentials?: {
        clientId?: string,
        clientSecret?: string,
        redirectUri?: string,
        accessToken?: string,
        refreshToken?: string
    },
    logging?: {
        level?: LogLevel,
        path?: string,
    },
    snoowrap?: {
        proxy?: string,
        debug?: boolean,
    }
    subreddits?: {
        names?: string[],
        dryRun?: boolean,
        wikiConfig?: string,
        heartbeatInterval?: number,
    },
    polling?: PollingDefaults & {
        sharedMod?: boolean,
        limit?: number,
        interval?: number,
    },
    web?: {
        enabled?: boolean,
        port?: number,
        session?: {
            provider?: 'memory' | 'redis' | CacheOptions,
            secret?: string,
        }
        logLevel?: LogLevel,
        maxLogs?: number,
    }
    // caching?:  (SubredditCacheConfig & {
    //     provider?: CacheProvider | CacheOptions | undefined
    // }) | CacheProvider | undefined
    caching?: {
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
        provider?: CacheProvider | CacheOptions
    } | CacheProvider
    api?: {
        softLimit?: number,
        hardLimit?: number,
    }
}

export interface OperatorConfig extends OperatorJsonConfig {
    operator: {
        name?: string
        display?: string,
    },
    credentials: {
        clientId: string,
        clientSecret: string,
        redirectUri?: string,
        accessToken?: string,
        refreshToken?: string
    },
    logging: {
        level: LogLevel,
        path?: string,
    },
    snoowrap: {
        proxy?: string,
        debug?: boolean,
    }
    subreddits: {
        names?: string[],
        dryRun?: boolean,
        wikiConfig: string,
        heartbeatInterval: number,
    },
    polling: {
        sharedMod: boolean,
        limit: number,
        interval: number,
    },
    web: {
        enabled: boolean,
        port: number,
        session: {
            provider: CacheOptions,
            secret: string,
        }
        logLevel?: LogLevel,
        maxLogs: number,
    }
    caching: {
        authorTTL: number,
        userNotesTTL: number,
        wikiTTL: number
        provider: CacheOptions
    },
    api: {
        softLimit: number,
        hardLimit: number,
    }
}

//export type OperatorConfig = Required<OperatorJsonConfig>;

interface CacheTypeStat {
    requests: number,
    miss: number,
}

export interface ResourceStats {
    [key: string]: CacheTypeStat
}
