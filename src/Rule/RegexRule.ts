import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {
    asSubmission,
    FAIL, isExternalUrlSubmission, isSubmission, parseRegex, parseStringToRegex,
    PASS, triggeredIndicator, windowConfigToWindowCriteria
} from "../util";
import {
    RegExResultWithTest,
    RuleResult,
} from "../Common/interfaces";
import dayjs from 'dayjs';
import {SimpleError} from "../Utils/Errors";
import {JoinOperands} from "../Common/Infrastructure/Atomic";
import {ActivityWindowConfig} from "../Common/Infrastructure/ActivityWindow";
import {
    comparisonTextOp, GenericComparison,
    parseGenericValueComparison,
    parseGenericValueOrPercentComparison
} from "../Common/Infrastructure/Comparisons";
import {SnoowrapActivity} from "../Common/Infrastructure/Reddit";

export interface RegexCriteria {
    /**
     * A descriptive name that will be used in logging and be available for templating
     *
     * @examples ["swear words"]
     * */
    name?: string
    /**
     * A valid Regular Expression, or list of expressions, to test content against
     *
     * If no flags are specified then the **global** flag is used by default
     *
     * @examples ["/reddit|FoxxMD/ig"]
     * */
    regex: string | string[],

    /**
     * Determines if ALL regexes listed are run or if regexes are only run until one is matched.
     *
     * * `true` => all regexes are always run
     * * `false` => regexes are run until one matches
     *
     * @default false
     * */
    exhaustive?: boolean

    /**
     * Which content from an Activity to test the regex against
     *
     * Only used if the Activity being tested is a Submission -- Comments are only tested against their content (duh)
     *
     * @default ["title", "body"]
     * */
    testOn?: ('title' | 'body' | 'url')[]

    /**
     * DEPRECATED - use `window.fetch` instead
     *
     * When used with `window` determines what type of Activities to retrieve
     *
     * @default "all"
     * @deprecationMessage use `window.fetch` instead
     * */
    lookAt?: 'submissions' | 'comments' | 'all',

    /**
     * A string containing a comparison operator and a value to determine when an Activity is determined "matched"
     *
     * The syntax is `(< OR > OR <= OR >=) <number>`
     *
     * * EX `> 7  => greater than 7 matches found in the Activity, Activity is matched
     * * EX `<= 3` => less than 3 matches found in the Activity, Activity is matched
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)(\s+.*)*$
     * @default "> 0"
     * @examples ["> 0"]
     * */
    matchThreshold?: string,

    /**
     * An string containing a comparison operator and a value to determine how many Activities need to be "matched" (based on `matchThreshold` condition) to trigger the rule
     *
     * **Only useful when used in conjunction with `window`**. If no `window` is specified only the Activity being checked is tested (so the default should/will be used).
     *
     * To disable (you are only using `totalMatchThreshold`) set to `null`
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 3`  => greater than 3 Activities met the `matchThreshold` condition, Rule is triggered
     * * EX `<= 10%` => less than 10% of all Activities retrieved from `window` met the `matchThreshold` condition, Rule is triggered
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @default "> 0"
     * @examples ["> 0"]
     * */
    activityMatchThreshold?: string,

    /**
     * A string containing a comparison operator and a value to determine how many total matches satisfies the criteria.
     *
     * If both this and `activityMatchThreshold` are present then whichever is satisfied first will be used.
     *
     * If not using `window` then this should not be used as running `matchThreshold` on one Activity is effectively the same behavior ( but I'm not gonna stop ya ¯\\\_(ツ)\_/¯ )
     *
     * The syntax is `(< OR > OR <= OR >=) <number>`
     *
     * * EX `> 7`  => greater than 7 matches found in Activity + Author history `window`
     * * EX `<= 3` => less than 3 matches found in the Activity + Author history `window`
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)(\s+.*)*$
     * @default "null"
     * @examples ["> 0"]
     * */
    totalMatchThreshold?: string,

    /**
     * When `true` the Activity being checked MUST pass the `matchThreshold` before the Rule considers any history
     *
     * For use with `activityMatchThreshold`/`totalMatchThreshold` -- useful to conserve API calls
     *
     * @default false
     * */
    mustMatchCurrent?: boolean

    window?: ActivityWindowConfig
}

export class RegexRule extends Rule {
    criteria: RegexCriteria[];
    condition: JoinOperands;

    constructor(options: RegexRuleOptions) {
        super(options);
        const {
            criteria = [],
            condition = 'OR'
        } = options || {};
        if (criteria.length < 1) {
            throw new Error('Must provide at least one RegexCriteria');
        }
        this.criteria = criteria;
        this.condition = condition;

        if(this.criteria.some(x => x.lookAt !== undefined)) {
            this.logger.warn(`Some criteria use 'lookAt' which is deprecated. Use 'window.fetch' instead`);
        }
    }

    getKind(): string {
        return 'regex';
    }

    getSpecificPremise(): object {
        return {
            criteria: this.criteria,
            condition: this.condition,
        }
    }

    protected async process(item: Submission | Comment): Promise<[boolean, RuleResult]> {

        let criteriaResults = [];

        for (const [index, criteria] of this.criteria.entries()) {

            const {
                name = (index + 1),
                regex,
                exhaustive = false,
                testOn: testOnVals = ['title', 'body'],
                lookAt = 'all',
                matchThreshold = '> 0',
                activityMatchThreshold = '> 0',
                totalMatchThreshold = null,
                mustMatchCurrent = false,
                window,
            } = criteria;

            // normalize their values and also ensure we don't have duplicates
            const testOn = testOnVals.map(y => y.toLowerCase()).reduce((acc: string[], curr) => {
                if (acc.includes(curr)) {
                    return acc;
                }
                return acc.concat(curr);
            }, []);

            const regexTests: RegExp[] = await this.convertToRegexArray(name, regex);

            const matchComparison = parseGenericValueComparison(matchThreshold);
            const activityMatchComparison = activityMatchThreshold === null ? undefined : parseGenericValueOrPercentComparison(activityMatchThreshold);
            const totalMatchComparison = totalMatchThreshold === null ? undefined : parseGenericValueComparison(totalMatchThreshold);

            // since we are dealing with user input (regex) it's likely they mess up their expression and end up matching *a lot* of stuff
            // so to keep memory under control only keep the first 100 matches
            // and just count the rest
            let matches: string[] = [];
            let matchCount = 0;
            let activitiesMatchedCount = 0;
            let activitiesTested = 0;
            let activityThresholdMet;
            let totalThresholdMet;

            // first lets see if the activity we are checking satisfies thresholds
            // since we may be able to avoid api calls to get history
            let actMatches = getMatchesFromActivity(item, testOn, regexTests, exhaustive);
            const actMatchSummary = regexResultsSummary(actMatches);
            matches = matches.concat(actMatchSummary.matches).slice(0, 100);
            matchCount += actMatchSummary.matches.length;

            activitiesTested++;
            const singleMatched = comparisonTextOp(actMatchSummary.matches.length, matchComparison.operator, matchComparison.value);
            if (singleMatched) {
                activitiesMatchedCount++;
            }
            const singleCriteriaPass = !mustMatchCurrent || (mustMatchCurrent && singleMatched);

            if (activityMatchComparison !== undefined) {
                activityThresholdMet = !activityMatchComparison.isPercent && comparisonTextOp(activitiesMatchedCount, activityMatchComparison.operator, activityMatchComparison.value);
            }
            if (totalMatchComparison !== undefined) {
                totalThresholdMet = comparisonTextOp(matchCount, totalMatchComparison.operator, totalMatchComparison.value);
            }

            let history: (Submission | Comment)[] = [];
            if ((activityThresholdMet === false || totalThresholdMet === false) && window !== undefined && singleCriteriaPass) {
                // our checking activity didn't meet threshold requirements and criteria does define window
                // leh go

                const strongWindow = windowConfigToWindowCriteria(window);
                if(strongWindow.fetch === undefined) {
                    switch (lookAt) {
                        case 'submissions':
                            strongWindow.fetch = 'submission';
                            break;
                        case 'comments':
                            strongWindow.fetch = 'comment';
                    }
                }

                history = await this.resources.getAuthorActivities(item.author, strongWindow);
                // remove current activity if it exists in history so we don't count it twice
                history = history.filter(x => x.id !== item.id);
                const historyLength = history.length;

                let activityCountFunc: Function | undefined;
                if (activityMatchComparison !== undefined) {
                    if (activityMatchComparison.isPercent) {
                        activityCountFunc = (actsMatched: number) => {
                            return comparisonTextOp(actsMatched / historyLength, activityMatchComparison.operator, activityMatchComparison.value / 100);
                        }
                    } else {
                        activityCountFunc = (actsMatched: number) => {
                            return comparisonTextOp(actsMatched, activityMatchComparison.operator, activityMatchComparison.value);
                        }
                    }
                }

                for (const h of history) {
                    activitiesTested++;
                    const aMatches = getMatchesFromActivity(h, testOn, regexTests, exhaustive);
                    actMatches = actMatches.concat(aMatches);
                    const actHistoryMatchSummary = regexResultsSummary(aMatches);
                    matches = matches.concat(actHistoryMatchSummary.matches).slice(0, 100);
                    matchCount += actHistoryMatchSummary.matches.length;
                    const matched = comparisonTextOp(actHistoryMatchSummary.matches.length, matchComparison.operator, matchComparison.value);
                    if (matched) {
                        activitiesMatchedCount++;
                    }
                    if (activityCountFunc !== undefined && activityThresholdMet !== true && activityCountFunc(activitiesMatchedCount)) {
                        activityThresholdMet = true;
                    }
                    if (totalMatchComparison !== undefined && totalThresholdMet !== true) {
                        totalThresholdMet = comparisonTextOp(matchCount, totalMatchComparison.operator, totalMatchComparison.value)
                    }
                }
            }

            let humanWindow = '';
            if (history.length > 0) {
                if (typeof window === 'number') {
                    humanWindow = `${history.length} Items`;
                } else {
                    const firstActivity = history[0];
                    const lastActivity = history[history.length - 1];

                    humanWindow = dayjs.duration(dayjs(firstActivity.created_utc * 1000).diff(dayjs(lastActivity.created_utc * 1000))).humanize();
                }
            } else {
                humanWindow = '1 Item';
            }

            // to provide at least one useful regex for this criteria
            // use the first regex found by default
            let relevantRegex: string = regexTests[0].toString();
            // but if more than one regex was listed AND we did have matches
            // then use the first regex that actually got a match
            if(regexTests.length > 0 && actMatches.length > 0) {
                relevantRegex = actMatches[0].test.toString();
            }

            const critResults = {
                criteria: {
                    name,
                    regex: relevantRegex,
                    testOn,
                    matchThreshold,
                    activityMatchThreshold,
                    totalMatchThreshold,
                    window: humanWindow,
                    mustMatchCurrent,
                },
                matches,
                matchCount,
                activitiesMatchedCount,
                activityThresholdMet,
                totalThresholdMet,
                triggered: false,
            };

            if (activityThresholdMet === undefined && totalThresholdMet === undefined) {
                // user should not have disabled both but in this scenario we'll pretend activityThresholdMet = singleMatch
                critResults.activityThresholdMet = singleMatched;
                critResults.triggered = singleMatched;
            } else {
                critResults.triggered = activityThresholdMet === true || totalThresholdMet === true;
            }

            criteriaResults.push(critResults);

            if (this.condition === 'OR') {
                if (critResults.triggered) {
                    break;
                }
            } else if (!critResults.triggered) {
                // since its AND and didn't match the whole rule will fail
                break;
            }
        }

        const criteriaMet = this.condition === 'OR' ? criteriaResults.some(x => x.triggered) : criteriaResults.every(x => x.triggered);

        const logSummary: string[] = [];
        let index = 0;
        let matchSample = undefined;
        for (const c of criteriaResults) {
            index++;
            let msg = `Criteria ${c.criteria.name || `#${index}`} ${triggeredIndicator(c.triggered)}`;
            if (c.activityThresholdMet !== undefined) {
                msg = `${msg} -- Activity Match ${triggeredIndicator(c.activityThresholdMet)} => ${c.activitiesMatchedCount} ${c.criteria.activityMatchThreshold} (Threshold ${c.criteria.matchThreshold})`;
            }
            if (c.totalThresholdMet !== undefined) {
                msg = `${msg} -- Total Matches ${triggeredIndicator(c.totalThresholdMet)} => ${c.matchCount} ${c.criteria.totalMatchThreshold}`;
            } else {
                msg = `${msg} and ${c.matchCount} Total Matches`;
            }
            msg = `${msg} (Window: ${c.criteria.window})`;
            if(c.matches.length > 0) {
                matchSample = `${c.matches.slice(0, 3).map(x => `"${x}"`).join(', ')}${c.matches.length > 3 ? `, and ${c.matches.length - 3} more...` : ''}`;
                logSummary.push(`${msg} -- Matched Values: ${matchSample}`);
            } else {
                logSummary.push(msg);
            }
        }

        const result = `${triggeredIndicator(criteriaMet)} ${logSummary.join(' || ')}`;
        this.logger.verbose(result);

        return Promise.resolve([criteriaMet, this.getResult(criteriaMet, {result, data: {results: criteriaResults, matchSample }})]);
    }

    protected async convertToRegexArray(name: string | number, value: string | string[]): Promise<RegExp[]> {
        const regexTests: RegExp[] = [];
        const regexStringVals = typeof value === 'string' ? [value] : value;
        for(const r of regexStringVals) {
            // check regex
            const regexContent = await this.resources.getContent(r);
            const reg = parseStringToRegex(regexContent, 'ig');
            if (reg === undefined) {
                throw new SimpleError(`Value given for regex on Criteria ${name} was not valid: ${value}`);
            }
            // ok cool its a valid regex
            regexTests.push(reg);
        }
        return regexTests;
    }
}

export const getMatchResultsFromContent = (contents: string[], reg: RegExp): RegExResultWithTest[] => {
    let m: RegExResultWithTest[] = [];
    for (const c of contents) {
        const results = parseRegex(reg, c);
        if(results !== undefined) {
            for(const r of results) {
                m.push({...r, test: reg});
            }
        }
    }
    return m;
}

export const regexResultsSummary = (results: RegExResultWithTest[]) => {
    const matchResults: ActivityMatchResults = {
        matches: [],
        matchesByTest: {},
        groups: {}
    }

    for (const r of results) {
        if (matchResults.matchesByTest[r.test.toString()] === undefined) {
            matchResults.matchesByTest[r.test.toString()] = [];
        }
        matchResults.matchesByTest[r.test.toString()].push(r.match);
        matchResults.matches.push(r.match);
        if (r.named !== undefined) {
            Object.entries(r.named).forEach(([key, val]) => {
                if (matchResults.groups[key] === undefined) {
                    matchResults.groups[key] = [];
                }
                matchResults.groups[key].push(val);
            });
        }
    }
    return matchResults;
}

export const getMatchesFromActivity = (a: (Submission | Comment), testOn: string[], regexes: RegExp[], exhaustive: boolean): RegExResultWithTest[] => {
    // determine what content we are testing
    let contents: string[] = getMatchableContent(a, testOn);
    let results: RegExResultWithTest[] = [];

    for (const reg of regexes) {
        const res = getMatchResultsFromContent(contents, reg);
        if(res.length > 0) {
            results = results.concat(res);
            // only continue testing if the user wants to exhaustively check all regexes (to get more matches?)
            if(!exhaustive) {
                return results;
            }
        }
    }
    return results;
}

const getMatchableContent = (a: SnoowrapActivity, testOn: string[]) => {
    let contents: string[] = [];
    if (asSubmission(a)) {
        for (const l of testOn) {
            switch (l) {
                case 'title':
                    contents.push(a.title);
                    break;
                case 'body':
                    if (a.is_self) {
                        contents.push(a.selftext);
                    }
                    break;
                case 'url':
                    if (isExternalUrlSubmission(a)) {
                        contents.push(a.url);
                    }
                    break;
            }
        }
    } else {
        contents.push(a.body)
    }
    return contents;
}

interface RegexMatchComparisonOptions {
    matchComparison: GenericComparison
    activityMatchComparison?: GenericComparison
    totalMatchComparison?: GenericComparison
}

interface ActivityMatchResults {
    matches: string[]
    matchesByTest: Record<string, string[]>
    groups: Record<string, string[]>
}

interface RegexConfig {
    /**
     * A list of Regular Expressions and conditions under which tested Activity(ies) are matched
     * @minItems 1
     * @examples [{"regex": "/reddit/", "matchThreshold": "> 3"}]
     * */
    criteria: RegexCriteria[]
    /**
     * * If `OR` then any set of Criteria that pass will trigger the Rule
     * * If `AND` then all Criteria sets must pass to trigger the Rule
     *
     * @default "OR"
     * */
    condition?: 'AND' | 'OR'
}

export interface RegexRuleOptions extends RegexConfig, RuleOptions {
}

/**
 * Test a (list of) Regular Expression against the contents or title of an Activity
 *
 * Optionally, specify a `window` of the User's history to additionally test against
 *
 * Available data for [Action templating](https://github.com/FoxxMD/context-mod#action-templating):
 *
 * */
export interface RegexRuleJSONConfig extends RegexConfig, RuleJSONConfig {
    /**
     * @examples ["regex"]
     * */
    kind: 'regex'
}

export default RegexRule;
