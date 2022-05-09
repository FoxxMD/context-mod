import { Submission, Comment } from "snoowrap/dist/objects";

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
 * A shorthand value for a DayJS duration consisting of a number value and time unit
 *
 * * EX `9 days`
 * * EX `3 months`
 * @pattern ^\s*(?<time>\d+)\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)\s*$
 * */
export type DayJSShorthand = string;
/**
 * An ISO 8601 Duration
 * @pattern ^(-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$
 * */
export type ISO8601 = string;
export type DurationString = DayJSShorthand | ISO8601;
export type DurationVal = DurationString | DurationObject;

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

export type JoinOperands = 'OR' | 'AND';
export type PollOn = 'unmoderated' | 'modqueue' | 'newSub' | 'newComm';
export type ModeratorNames = 'self' | 'automod' | 'automoderator' | string;
export type Invokee = 'system' | 'user';
export type RunState = 'running' | 'paused' | 'stopped';
/**
 * Available cache providers
 * */
export type CacheProvider = 'memory' | 'redis' | 'none';
export type NotificationProvider = 'discord';
export type NotificationEventType = 'runStateChanged' | 'pollingError' | 'eventActioned' | 'configUpdated'

export interface ModeratorNameCriteria {
    behavior?: 'include' | 'exclude'
    name: ModeratorNames | ModeratorNames[]
}

export type StatisticFrequency = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
export const statFrequencies: StatisticFrequency[] = ['minute', 'hour', 'day', 'week', 'month', 'year'];
export type StatisticFrequencyOption = StatisticFrequency | false;
export type EventRetentionPolicyRange = DurationVal | number;
export type RedditEntityType = 'user' | 'subreddit';

export interface RedditEntity {
    name: string
    type: RedditEntityType
}

export type SearchFacetType = 'title' | 'url' | 'duplicates' | 'crossposts' | 'external';
export type FilterBehavior = 'include' | 'exclude'
export type GotoPath = `goto:${string}`;
/**
 * Possible outputs to store event details to
 * */
export type RecordOutputType = 'database' | 'influx';
export const recordOutputTypes: RecordOutputType[] = ['database', 'influx'];
/**
 * Possible options for output:
 *
 * * true -> store to all
 * * false -> store to none
 * * string -> store to this one output
 * * list -> store to these specified outputs
 * */
export type RecordOutputOption = boolean | RecordOutputType | RecordOutputType[]
/**
 * The possible behaviors that can occur after a check has run
 *
 * * next => continue to next Check/Run
 * * stop => stop CM lifecycle for this activity (immediately end)
 * * nextRun => skip any remaining Checks in this Run and start the next Run
 * * goto:[path] => specify a run[.check] to jump to
 *
 * */
export type PostBehaviorType = 'next' | 'stop' | 'nextRun' | string;
export type onExistingFoundBehavior = 'replace' | 'skip' | 'ignore';
export type ActionTarget = 'self' | 'parent';
export type InclusiveActionTarget = ActionTarget | 'any';
export type DispatchSource = 'dispatch' | `dispatch:${string}`;
export type NonDispatchActivitySource = 'poll' | `poll:${PollOn}` | 'user' | `user:${string}`;
export type ActivitySourceTypes = 'poll' | 'dispatch' | 'user'; // TODO
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

export type SnoowrapActivity = Submission | Comment;

export type AuthorActivitiesFull = [SnoowrapActivity[], {raw: SnoowrapActivity[], pre: SnoowrapActivity[], post: SnoowrapActivity[]}];
