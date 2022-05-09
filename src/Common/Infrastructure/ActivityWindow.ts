import {DurationVal} from "./Atomic";
import {FilterOptions, FilterOptionsJson, FilterOptionsConfig} from "./Filters/FilterShapes";
import {
    ActivityState,
    CommentState,
    StrongSubredditCriteria,
    SubmissionState,
    SubredditCriteria
} from "./Filters/FilterCriteria";
import {ActivityType, AuthorHistorySort, AuthorHistorySortTime, AuthorHistoryType} from "./Reddit";
import {Duration} from "dayjs/plugin/duration";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import {Listing} from "snoowrap";

export type ActivityWindowSatisfiedOn = 'any' | 'all';

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
export type ActivityWindowConfig = FullActivityWindowConfig | DurationVal | number;

/**
 * Multiple properties that may be used to define what range of Activity to retrieve.
 *
 * May specify one, or both properties along with the `satisfyOn` property, to affect the retrieval behavior.
 *
 * @examples [{"count": 100, "duration": {"days": 90}}]
 * @minProperties 1
 * @additionalProperties false
 * */
export interface FullActivityWindowConfig extends HistoryFiltersConfig {
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
    satisfyOn?: ActivityWindowSatisfiedOn;

    /**
     * Use to filter the Activities retrieved by subreddit or activity state
     *
     * Can be filtered **during** fetching using `pre` or **after** fetching results using `post`
     * */
    filterOn?: {
        /**
         * Filters to run for each new chunk of Activities retrieved. `count` and `duration` conditions will be checked AFTER filtering the new chunk
         * */
        pre?: PreHistoryFiltersConfig
        /**
         * Filters to run AFTER `count` and `duration` conditions have been triggered. Will filter the entire set of returned Activities.
         * */
        post?: HistoryFiltersConfig
    }

    /**
     * Specify the type of Activity (Comment or Submission) to retrieve for the window.
     *
     * Will be overridden if the type is specified in a parent rule (with property such as 'lookAs')
     * */
    fetch?: ActivityType | 'submissions' | 'comments' | 'all' | 'overview'

    /**
     * The number of Activities to retrieve on each API call. Defaults to 100 (maximum allowed).
     *
     * There is no reason to change this unless you are highly bandwidth-constrained and have a known problem space. Overridden by `count` when `count` <= 100
     * */
    chunkSize?: number,

    sort?: AuthorHistorySort
    sortTime?: AuthorHistorySortTime
}

export interface HistoryFiltersConfig {
    /**
     * Filter Activities based on their Subreddit.
     *
     * */
    subreddits?: FilterOptionsJson<SubredditCriteria>

    /**
     * When present, will only return Submissions retrieved from history that pass this filter
     *
     * Takes precedence over `activityState`
     * */
    submissionState?: FilterOptionsConfig<SubmissionState>

    /**
     * When present, will only return Comments retrieved from history that pass this filter
     *
     * Takes precedence over `activityState`
     * */
    commentState?: FilterOptionsConfig<CommentState>

    /**
     * When present, will only return Activities (Comment or Submission) retrieved from history that pass this filter
     * */
    activityState?: FilterOptionsConfig<ActivityState>
}

export interface PreHistoryFiltersConfig extends HistoryFiltersConfig {
    max: number | DurationVal
}

export interface ActivityWindow {

    window?: ActivityWindowConfig,
}

export interface HistoryFiltersOptions {
    subreddits?: FilterOptions<StrongSubredditCriteria>
    submissionState?: FilterOptions<SubmissionState>
    commentState?: FilterOptions<CommentState>
    activityState?: FilterOptions<ActivityState>
}

export interface PreHistoryFiltersOptions extends HistoryFiltersOptions {
    max: number | Duration
}

export interface ActivityWindowCriteria {
    count?: number
    duration?: Duration
    satisfyOn: ActivityWindowSatisfiedOn
    filterOn?: {
        pre?: PreHistoryFiltersOptions
        post?: HistoryFiltersOptions
    }
    fetch?: AuthorHistoryType,
    chunkSize?: number,
    includeFilter?: (items: (Submission | Comment)[], states: StrongSubredditCriteria[]) => Promise<(Submission | Comment)[]>
    excludeFilter?: (items: (Submission | Comment)[], states: StrongSubredditCriteria[]) => Promise<(Submission | Comment)[]>
    sort?: AuthorHistorySort
    sortTime?: AuthorHistorySortTime
    [key: string]: any
}

export type ListingFunc = (options?: object) => Promise<Listing<Submission | Comment>>;

export interface NamedListing {
    func: ListingFunc
    name: string
}
