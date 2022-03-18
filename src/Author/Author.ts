import {UserNoteCriteria} from "../Rule";
import {CompareValue, CompareValueOrPercent, DurationComparor, JoinOperands} from "../Common/interfaces";
import {parseStringToRegex} from "../util";

/**
 * If present then these Author criteria are checked before running the rule. If criteria fails then the rule is skipped.
 * @examples [{"include": [{"flairText": ["Contributor","Veteran"]}, {"isMod": true}]}]
 * */
export interface AuthorOptions {
    /**
     * Will "pass" if any set of AuthorCriteria passes
     * */
    include?: AuthorCriteria[];
    /**
     * * OR => if ANY exclude condition "does not" pass then the exclude test passes
     * * AND => if ALL exclude conditions "do not" pass then the exclude test passes
     *
     * Defaults to OR
     * @default OR
     * */
    excludeCondition?: JoinOperands
    /**
     * Only runs if `include` is not present. Each AuthorCriteria is comprised of conditions that the Author being checked must "not" pass. See excludeCondition for set behavior
     *
     * EX: `isMod: true, name: Automoderator` => Will pass if the Author IS NOT a mod and IS NOT named Automoderator
     * */
    exclude?: AuthorCriteria[];
}

/**
 * Criteria with which to test against the author of an Activity. The outcome of the test is based on:
 *
 * 1. All present properties passing and
 * 2. If a property is a list then any value from the list matching
 *
 * @minProperties 1
 * @additionalProperties false
 * @examples [{"flairText": ["Contributor","Veteran"], "isMod": true, "name": ["FoxxMD", "AnotherUser"] }]
 * */
export interface AuthorCriteria {
    /**
     * A list of reddit usernames (case-insensitive) to match against. Do not include the "u/" prefix
     *
     *  EX to match against /u/FoxxMD and /u/AnotherUser use ["FoxxMD","AnotherUser"]
     * @examples ["FoxxMD","AnotherUser"]
     * */
    name?: string[],
    /**
     * A (user) flair css class (or list of) from the subreddit to match against
     *
     * * If `true` then passes if ANY css is assigned
     * * If `false` then passes if NO css is assigned
     * @examples ["red"]
     * */
    flairCssClass?: boolean | string | string[],
    /**
     * A (user) flair text value (or list of) from the subreddit to match against
     *
     * * If `true` then passes if ANY text is assigned
     * * If `false` then passes if NO text is assigned
     *
     * @examples ["Approved"]
     * */
    flairText?: boolean | string | string[],

    /**
     * A (user) flair template id (or list of) from the subreddit to match against
     *
     * * If `true` then passes if ANY template is assigned
     * * If `false` then passed if NO template is assigned
     *
     * */
    flairTemplate?: boolean | string | string[]
    /**
     * Is the author a moderator?
     * */
    isMod?: boolean,
    /**
     * A list of UserNote properties to check against the User Notes attached to this Author in this Subreddit (must have Toolbox enabled and used User Notes at least once)
     * */
    userNotes?: UserNoteCriteria[]

    /**
     * Test the age of the Author's account (when it was created) against this comparison
     *
     * The syntax is `(< OR > OR <= OR >=) <number> <unit>`
     *
     * * EX `> 100 days` => Passes if Author's account is older than 100 days
     * * EX `<= 2 months` => Passes if Author's account is younger than or equal to 2 months
     *
     * Unit must be one of [DayJS Duration units](https://day.js.org/docs/en/durations/creating)
     *
     * [See] https://regexr.com/609n8 for example
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)\s*$
     * */
    age?: DurationComparor

    /**
     * A string containing a comparison operator and a value to compare link karma against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 100`  => greater than 100 link karma
     * * EX `<= 75%` => link karma is less than or equal to 75% of **all karma**
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    linkKarma?: CompareValueOrPercent

    /**
     * A string containing a comparison operator and a value to compare karma against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 100`  => greater than 100 comment karma
     * * EX `<= 75%` => comment karma is less than or equal to 75% of **all karma**
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    commentKarma?: CompareValueOrPercent

    totalKarma?: CompareValue

    /**
     * Does Author's account have a verified email?
     * */
    verified?: boolean

    /**
     * Is the author shadowbanned?
     *
     * This is determined by trying to retrieve the author's profile. If a 404 is returned it is likely they are shadowbanned
     * */
    shadowBanned?: boolean

    /**
     * An (array of) string/regular expression to test contents of an Author's profile description against
     *
     * If no flags are specified then the **insensitive** flag is used by default
     *
     * If using an array then if **any** value in the array passes the description test passes
     *
     * @examples [["/test$/i", "look for this string literal"]]
     * */
    description?: string | string[]

    /**
     * Is the author an approved user (contributor)?
     * */
    isContributor?: boolean
}

export class Author implements AuthorCriteria {
    name?: string[];
    flairCssClass?: boolean | string[];
    flairText?: boolean | string[];
    isMod?: boolean;
    isContributor?: boolean;
    userNotes?: UserNoteCriteria[];
    age?: string;
    commentKarma?: string;
    linkKarma?: string;
    totalKarma?: string;
    verified?: boolean;
    shadowBanned?: boolean;
    description?: string[];

    constructor(options: AuthorCriteria) {
        this.name = options.name;
        if(options.flairCssClass !== undefined) {
            this.flairCssClass = typeof options.flairCssClass === 'string' ? [options.flairCssClass] : options.flairCssClass;
        }
        if(options.flairText !== undefined) {
            this.flairText = typeof options.flairText === 'string' ? [options.flairText] : options.flairText;
        }
        this.isMod = options.isMod;
        this.isContributor = options.isContributor;
        this.userNotes = options.userNotes;
        this.age = options.age;
        this.commentKarma = options.commentKarma;
        this.linkKarma = options.linkKarma;
        this.totalKarma = options.totalKarma;
        this.shadowBanned = options.shadowBanned;
        this.description = options.description === undefined ? undefined : Array.isArray(options.description) ? options.description : [options.description];
    }
}

export default Author;
