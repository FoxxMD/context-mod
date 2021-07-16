import winston, {Logger} from "winston";
import jsonStringify from 'safe-stable-stringify';
import dayjs, {Dayjs, OpUnitType} from 'dayjs';
import {isRuleSetResult, RulePremise, RuleResult, RuleSetResult} from "./Rule";
import deepEqual from "fast-deep-equal";
import {Duration} from 'dayjs/plugin/duration.js';
import Ajv from "ajv";
import {InvalidOptionArgumentError} from "commander";
import Submission from "snoowrap/dist/objects/Submission";
import {Comment} from "snoowrap";
import {inflateSync, deflateSync} from "zlib";
import {
    ActivityWindowCriteria,
    DurationComparison,
    GenericComparison,
    PollingOptionsStrong,
    StringOperator
} from "./Common/interfaces";
import JSON5 from "json5";
import yaml, {JSON_SCHEMA} from "js-yaml";
import SimpleError from "./Utils/SimpleError";
import InvalidRegexError from "./Utils/InvalidRegexError";

const {format} = winston;
const {combine, printf, timestamp, label, splat, errors} = format;

const s = splat();
const SPLAT = Symbol.for('splat')
//const errorsFormat = errors({stack: true});
const CWD = process.cwd();

// const errorAwareFormat = (info: any) => {
//     if(info instanceof SimpleError) {
//         return errors()(info);
//     }
// }
const errorAwareFormat = {
    transform: (info: any, opts: any) => {
        // don't need to log stack trace if we know the error is just a simple message (we handled it)
        const stack = !(info instanceof SimpleError) && !(info.message instanceof SimpleError);
        return errors().transform(info, { stack });
    }
}

export const PASS = '✔';
export const FAIL = '✘';

export const truncateStringToLength = (length: number, truncStr = '...') => (str: string) => str.length > length ? `${str.slice(0, length - truncStr.length - 1)}${truncStr}` : str;

export const defaultFormat = printf(({
                                         level,
                                         message,
                                         labels = ['App'],
                                         subreddit,
                                         leaf,
                                         itemId,
                                         timestamp,
                                        // @ts-ignore
                                         [SPLAT]: splatObj,
                                         stack,
                                         ...rest
                                     }) => {
    let stringifyValue = splatObj !== undefined ? jsonStringify(splatObj) : '';
    let msg = message;
    let stackMsg = '';
    if (stack !== undefined) {
        const stackArr = stack.split('\n');
        const stackTop = stackArr[0];
        const cleanedStack = stackArr
            .slice(1) // don't need actual error message since we are showing it as msg
            .map((x: string) => x.replace(CWD, 'CWD')) // replace file location up to cwd for user privacy
            .join('\n'); // rejoin with newline to preserve formatting
        stackMsg = `\n${cleanedStack}`;
        if(msg === undefined || msg === null || typeof message === 'object') {
            msg = stackTop;
        } else {
            stackMsg = `\n${stackTop}${stackMsg}`
        }
    }

    let nodes = labels;
    if (leaf !== null && leaf !== undefined) {
        nodes.push(leaf);
    }
    const labelContent = `${nodes.map((x: string) => `[${x}]`).join(' ')}`;

    return `${timestamp} ${level.padEnd(7)}: ${subreddit !== undefined ? `{${subreddit}} ` : ''}${labelContent} ${msg}${stringifyValue !== '' ? ` ${stringifyValue}` : ''}${stackMsg}`;
});


export const labelledFormat = (labelName = 'App') => {
    const l = label({label: labelName, message: false});
    return combine(
        timestamp(
            {
                format: () => dayjs().local().format(),
            }
        ),
        l,
        s,
        errorAwareFormat,
        //errorsFormat,
        defaultFormat,
    );
}

export interface groupByOptions {
    lowercase?: boolean
}

/**
 * Group array of objects by given keys
 * @param keys keys to be grouped by
 * @param opts
 * @param array objects to be grouped
 * @returns an object with objects in `array` grouped by `keys`
 * @see <https://gist.github.com/mikaello/06a76bca33e5d79cdd80c162d7774e9c>
 */
export const groupBy = <T>(keys: (keyof T)[], opts: groupByOptions = {}) => (array: T[]): Record<string, T[]> => {
    const {lowercase = false} = opts;
    return array.reduce((objectsByKeyValue, obj) => {
        let value = keys.map((key) => obj[key]).join('-');
        if (lowercase) {
            value = value.toLowerCase();
        }
        objectsByKeyValue[value] = (objectsByKeyValue[value] || []).concat(obj);
        return objectsByKeyValue;
    }, {} as Record<string, T[]>)
};

// match /mealtimesvideos/ /comments/ etc... (?:\/.*\/)
// matches https://old.reddit.com/r  (?:^.+?)(?:reddit.com\/r)
// (?:^.+?)(?:reddit.com\/r\/.+\/.\/)
// (?:.*\/)([\d\w]+?)(?:\/*)

/**
 * @see https://stackoverflow.com/a/61033353/1469797
 */
const REGEX_YOUTUBE: RegExp = /(?:https?:\/\/)?(?:www\.)?youtu(?:\.be\/|be.com\/\S*(?:watch|embed)(?:(?:(?=\/[^&\s\?]+(?!\S))\/)|(?:\S*v=|v\/)))([^&\s\?]+)/g;

export const parseUsableLinkIdentifier = (regexes: RegExp[] = [REGEX_YOUTUBE]) => (val?: string): (string | undefined) => {
    if (val === undefined) {
        return val;
    }
    for (const reg of regexes) {
        const matches = [...val.matchAll(reg)];
        if (matches.length > 0) {
            // use first capture group
            // TODO make this configurable at some point?
            const captureGroup = matches[0][matches[0].length - 1];
            if(captureGroup !== '') {
                return captureGroup;
            }
        }
    }
    return val;
}

export const parseLinkIdentifier = (regexes: RegExp[]) => {
    const u = parseUsableLinkIdentifier(regexes);
    return (val: string): (string | undefined) => {
        const id = u(val);
        if (id === val) {
            return undefined;
        }
        return id;
    }
}

export const SUBMISSION_URL_ID: RegExp = /(?:^.+?)(?:reddit.com\/r)(?:\/[\w\d]+){2}(?:\/)([\w\d]*)/g;
export const COMMENT_URL_ID: RegExp = /(?:^.+?)(?:reddit.com\/r)(?:\/[\w\d]+){4}(?:\/)([\w\d]*)/g;

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const findResultByPremise = (premise: RulePremise, results: RuleResult[]): (RuleResult | undefined) => {
    if (results.length === 0) {
        return undefined;
    }
    return results.find((x) => {
        return deepEqual(premise, x.premise);
    })
}

export const determineNewResults = (existing: RuleResult[], val: RuleResult | RuleResult[]): RuleResult[] => {
    const requestedResults = Array.isArray(val) ? val : [val];
    const combined = [...existing];
    const newResults = [];

    // not sure this should be used since grouped results will be stale as soon as a new result is added --
    // would need a guarantee all results in val are unique
    // const groupedResultsByKind = newResults.reduce((grouped, res) => {
    //     grouped[res.premise.kind] = (grouped[res.premise.kind] || []).concat(res);
    //     return grouped;
    // }, {} as Record<string, RuleResult[]>);
    // for(const kind of Object.keys(groupedResultsByKind)) {
    //     const relevantExisting = combined.filter(x => x.premise.kind === kind)
    // }

    for (const result of requestedResults) {
        const relevantExisting = combined.filter(x => x.premise.kind === result.premise.kind).find(x => deepEqual(x.premise, result.premise));
        if (relevantExisting === undefined) {
            combined.push(result);
            newResults.push(result);
        }
    }
    return newResults;
}

export const mergeArr = (objValue: [], srcValue: []): (any[] | undefined) => {
    if (Array.isArray(objValue)) {
        return objValue.concat(srcValue);
    }
}

export const ruleNamesFromResults = (results: RuleResult[]) => {
    return results.map(x => x.name || x.premise.kind).join(' | ')
}

export const triggeredIndicator = (val: boolean | null): string => {
    if(val === null) {
        return '-';
    }
    return val ? PASS : FAIL;
}

export const resultsSummary = (results: (RuleResult|RuleSetResult)[], topLevelCondition: 'OR' | 'AND'): string => {
    const parts: string[] = results.map((x) => {
        if(isRuleSetResult(x)) {
            return `${triggeredIndicator(x.triggered)} (${resultsSummary(x.results, x.condition)}${x.results.length === 1 ? ` [${x.condition}]` : ''})`;
        }
        const res = x as RuleResult;
        return `${triggeredIndicator(x.triggered)} ${res.name}`;
    });
    return parts.join(` ${topLevelCondition} `)
    //return results.map(x => x.name || x.premise.kind).join(' | ')
}

export const createAjvFactory = (logger: Logger) => {
    return  new Ajv({logger: logger, verbose: true, strict: "log", allowUnionTypes: true});
}

export const percentFromString = (str: string): number => {
   const n = Number.parseInt(str.replace('%', ''));
   if(Number.isNaN(n)) {
       throw new Error(`${str} could not be parsed to a number`);
   }
   return n / 100;
}

export interface numberFormatOptions {
    toFixed: number,
    defaultVal?: any,
    prefix?: string,
    suffix?: string,
    round?: {
        type?: string,
        enable: boolean,
        indicate?: boolean,
    }
}

export const formatNumber = (val: number | string, options?: numberFormatOptions) => {
    const {
        toFixed = 2,
        defaultVal = null,
        prefix = '',
        suffix = '',
        round,
    } = options || {};
    let parsedVal = typeof val === 'number' ? val : Number.parseFloat(val);
    if (Number.isNaN(parsedVal)) {
        return defaultVal;
    }
    let prefixStr = prefix;
    const {enable = false, indicate = true, type = 'round'} = round || {};
    if (enable && !Number.isInteger(parsedVal)) {
        switch (type) {
            case 'round':
                parsedVal = Math.round(parsedVal);
                break;
            case 'ceil':
                parsedVal = Math.ceil(parsedVal);
                break;
            case 'floor':
                parsedVal = Math.floor(parsedVal);
        }
        if (indicate) {
            prefixStr = `~${prefix}`;
        }
    }
    const localeString = parsedVal.toLocaleString(undefined, {
        minimumFractionDigits: toFixed,
        maximumFractionDigits: toFixed,
    });
    return `${prefixStr}${localeString}${suffix}`;
};

export function argParseInt(value: any, prev: any = undefined): number {
    let usedVal = value;
    if (value === undefined || value === '') {
        usedVal = prev;
    }
    if(usedVal === undefined || usedVal === '') {
        return usedVal;
    }

    if (typeof usedVal === 'string') {
        const parsedValue = parseInt(usedVal, 10);
        if (isNaN(parsedValue)) {
            throw new InvalidOptionArgumentError('Not a number.');
        }
        return parsedValue;
    } else if (typeof usedVal === 'number') {
        return usedVal;
    }
    throw new InvalidOptionArgumentError('Not a number.');
}

export function parseBool(value: any, prev: any = false): boolean {
    let usedVal = value;
    if (value === undefined || value === '') {
        usedVal = prev;
    }
    if(usedVal === undefined || usedVal === '') {
        return false;
    }
    if (typeof usedVal === 'string') {
        return usedVal === 'true';
    } else if (typeof usedVal === 'boolean') {
        return usedVal;
    }
    throw new InvalidOptionArgumentError('Not a boolean value.');
}

export function activityWindowText(activities: (Submission | Comment)[], suffix = false): (string | undefined) {
    if (activities.length === 0) {
        return undefined;
    }
    if (activities.length === 1) {
        return `1 Item`;
    }

    return dayjs.duration(dayjs(activities[0].created_utc * 1000).diff(dayjs(activities[activities.length - 1].created_utc * 1000))).humanize(suffix);
}

export function normalizeName(val: string) {
    return val.trim().replace(/\W+/g, '').toLowerCase()
}

// https://github.com/toolbox-team/reddit-moderator-toolbox/wiki/Subreddit-Wikis%3A-usernotes#working-with-the-blob
export const inflateUserNotes = (blob: string) => {
    //const binaryData = Buffer.from(blob, 'base64').toString('binary');
    //const str = pako.inflate(binaryData, {to: 'string'});

    const buffer = Buffer.from(blob, 'base64');
    const str = inflateSync(buffer).toString('utf-8');

    // @ts-ignore
    return JSON.parse(str);
}
// https://github.com/toolbox-team/reddit-moderator-toolbox/wiki/Subreddit-Wikis%3A-usernotes#working-with-the-blob
export const deflateUserNotes = (usersObject: object) => {
    const jsonString = JSON.stringify(usersObject);

    // Deflate/compress the string
    //const binaryData = pako.deflate(jsonString);
    const binaryData = deflateSync(jsonString);

    // Convert binary data to a base64 string with a Buffer
    const blob = Buffer.from(binaryData).toString('base64');
    return blob;
}

export const isActivityWindowCriteria = (val: any): val is ActivityWindowCriteria => {
    if (val !== null && typeof val === 'object') {
        return (val.count !== undefined && typeof val.count === 'number') ||
            // close enough
            val.duration !== undefined;
    }
    return false;
}

export const parseFromJsonOrYamlToObject = (content: string): [object?, Error?, Error?] => {
    let obj;
    let jsonErr,
        yamlErr;

    try {
        obj = JSON5.parse(content);
        const oType = obj === null ? 'null' : typeof obj;
        if (oType !== 'object') {
            jsonErr = new SimpleError(`Parsing as json produced data of type '${oType}' (expected 'object')`);
            obj = undefined;
        }
    } catch (err) {
        jsonErr = err;
    }
    if (obj === undefined) {
        try {
            obj = yaml.load(content, {schema: JSON_SCHEMA, json: true});
            const oType = obj === null ? 'null' : typeof obj;
            if (oType !== 'object') {
                yamlErr = new SimpleError(`Parsing as yaml produced data of type '${oType}' (expected 'object')`);
                obj = undefined;
            }
        } catch (err) {
            yamlErr = err;
        }
    }
    return [obj, jsonErr, yamlErr];
}

export const comparisonTextOp = (val1: number, strOp: string, val2: number): boolean => {
    switch (strOp) {
        case '>':
            return val1 > val2;
        case '>=':
            return val1 >= val2;
        case '<':
            return val1 < val2;
        case '<=':
            return val1 <= val2;
        default:
            throw new Error(`${strOp} was not a recognized operator`);
    }
}

const GENERIC_VALUE_COMPARISON = /^\s*(?<opStr>>|>=|<|<=)\s*(?<value>\d+)(?<extra>\s+.*)*$/
const GENERIC_VALUE_COMPARISON_URL = 'https://regexr.com/60dq4';
export const parseGenericValueComparison = (val: string): GenericComparison => {
    const matches = val.match(GENERIC_VALUE_COMPARISON);
    if (matches === null) {
        throw new InvalidRegexError(GENERIC_VALUE_COMPARISON, val, GENERIC_VALUE_COMPARISON_URL)
    }
    const groups = matches.groups as any;

    return {
        operator: groups.opStr as StringOperator,
        value: Number.parseFloat(groups.value),
        isPercent: false,
        extra: groups.extra,
        displayText: `${groups.opStr} ${groups.value}`
    }
}

const GENERIC_VALUE_PERCENT_COMPARISON = /^\s*(?<opStr>>|>=|<|<=)\s*(?<value>\d+)\s*(?<percent>%?)(?<extra>.*)$/
const GENERIC_VALUE_PERCENT_COMPARISON_URL = 'https://regexr.com/60a16';
export const parseGenericValueOrPercentComparison = (val: string): GenericComparison => {
    const matches = val.match(GENERIC_VALUE_PERCENT_COMPARISON);
    if (matches === null) {
        throw new InvalidRegexError(GENERIC_VALUE_PERCENT_COMPARISON, val, GENERIC_VALUE_PERCENT_COMPARISON_URL)
    }
    const groups = matches.groups as any;

    return {
        operator: groups.opStr as StringOperator,
        value: Number.parseFloat(groups.value),
        isPercent: groups.percent !== '',
        extra: groups.extra,
        displayText: `${groups.opStr} ${groups.value}${groups.percent === undefined ? '': '%'}`
    }
}

export const dateComparisonTextOp = (val1: Dayjs, strOp: StringOperator, val2: Dayjs, granularity?: OpUnitType): boolean => {
    switch (strOp) {
        case '>':
            return val1.isBefore(val2, granularity);
        case '>=':
            return val1.isSameOrBefore(val2, granularity);
        case '<':
            return val1.isAfter(val2, granularity);
        case '<=':
            return val1.isSameOrAfter(val2, granularity);
        default:
            throw new Error(`${strOp} was not a recognized operator`);
    }
}

const ISO8601_REGEX: RegExp = /^(-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
const DURATION_REGEX: RegExp = /^\s*(?<time>\d+)\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)\s*$/;
export const parseDuration = (val: string): Duration => {
    let matches = val.match(DURATION_REGEX);
    if (matches !== null) {
        const groups = matches.groups as any;
        const dur: Duration = dayjs.duration(groups.time, groups.unit);
        if (!dayjs.isDuration(dur)) {
            throw new SimpleError(`Parsed value '${val}' did not result in a valid Dayjs Duration`);
        }
        return dur;
    }
    matches = val.match(ISO8601_REGEX);
    if (matches !== null) {
        const dur: Duration = dayjs.duration(val);
        if (!dayjs.isDuration(dur)) {
            throw new SimpleError(`Parsed value '${val}' did not result in a valid Dayjs Duration`);
        }
        return dur;
    }
    throw new InvalidRegexError([DURATION_REGEX, ISO8601_REGEX], val)
}

/**
 * Named groups: operator, time, unit
 * */
const DURATION_COMPARISON_REGEX: RegExp = /^\s*(?<opStr>>|>=|<|<=)\s*(?<time>\d+)\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)\s*$/;
const DURATION_COMPARISON_REGEX_URL = 'https://regexr.com/609n8';
export const parseDurationComparison = (val: string): DurationComparison => {
    const matches = val.match(DURATION_COMPARISON_REGEX);
    if (matches === null) {
        throw new InvalidRegexError(DURATION_COMPARISON_REGEX, val, DURATION_COMPARISON_REGEX_URL)
    }
    const groups = matches.groups as any;
    const dur: Duration = dayjs.duration(groups.time, groups.unit);
    if (!dayjs.isDuration(dur)) {
        throw new SimpleError(`Parsed value '${val}' did not result in a valid Dayjs Duration`);
    }
    return {
        operator: groups.opStr as StringOperator,
        duration: dur
    }
}
export const compareDurationValue = (comp: DurationComparison, date: Dayjs) => {
    const dateToCompare = dayjs().subtract(comp.duration.asSeconds(), 'seconds');
    return dateComparisonTextOp(date, comp.operator, dateToCompare);
}

const SUBREDDIT_NAME_REGEX: RegExp = /^\s*(?:\/r\/|r\/)*(\w+)*\s*$/;
const SUBREDDIT_NAME_REGEX_URL = 'https://regexr.com/61a1d';
export const parseSubredditName = (val:string): string => {
    const matches = val.match(SUBREDDIT_NAME_REGEX);
    if (matches === null) {
        throw new InvalidRegexError(SUBREDDIT_NAME_REGEX, val, SUBREDDIT_NAME_REGEX_URL)
    }
    return matches[1] as string;
}

const WIKI_REGEX: RegExp = /^\s*wiki:(?<url>[^|]+)\|*(?<subreddit>[^\s]*)\s*$/;
const WIKI_REGEX_URL = 'https://regexr.com/61bq1';
const URL_REGEX: RegExp = /^\s*url:(?<url>[^\s]+)\s*$/;
const URL_REGEX_URL = 'https://regexr.com/61bqd';

export const parseWikiContext = (val: string) => {
    const matches = val.match(WIKI_REGEX);
    if (matches === null) {
        return undefined;
    }
    const sub = (matches.groups as any).subreddit as string;
    return {
        wiki: (matches.groups as any).url as string,
        subreddit: sub === '' ? undefined : parseSubredditName(sub)
    };
}

export const parseExternalUrl = (val: string) => {
    const matches = val.match(URL_REGEX);
    if (matches === null) {
        return undefined;
    }
    return (matches.groups as any).url as string;
}

export interface RetryOptions {
    maxRequestRetry: number,
    maxOtherRetry: number,
}

export const createRetryHandler = (opts: RetryOptions, logger: Logger) => {
    const {maxRequestRetry, maxOtherRetry} = opts;

    let timeoutCount = 0;
    let otherRetryCount = 0;
    let lastErrorAt: Dayjs | undefined;

    return async (err: any): Promise<boolean> => {
        if (lastErrorAt !== undefined && dayjs().diff(lastErrorAt, 'minute') >= 3) {
            // if its been longer than 5 minutes since last error clear counters
            timeoutCount = 0;
            otherRetryCount = 0;
        }

        lastErrorAt = dayjs();

        if(err.name === 'RequestError' || err.name === 'StatusCodeError') {
            if (err.statusCode === undefined || ([500, 503, 502, 504, 522].includes(err.statusCode))) {
                timeoutCount++;
                if (timeoutCount > maxRequestRetry) {
                    logger.error(`Reddit request error retries (${timeoutCount}) exceeded max allowed (${maxRequestRetry})`);
                    return false;
                }
                // exponential backoff
                const ms = (Math.pow(2, timeoutCount - 1) + (Math.random() - 0.3) + 1) * 1000;
                logger.warn(`Error occurred while making a request to Reddit (${timeoutCount} in 3 minutes). Will wait ${formatNumber(ms / 1000)} seconds before retrying`);
                await sleep(ms);
                return true;

            } else {
                return false;
            }
        } else {
            // linear backoff
            otherRetryCount++;
            if (maxOtherRetry < otherRetryCount) {
                return false;
            }
            const ms = (4 * 1000) * otherRetryCount;
            logger.warn(`Non-request error occurred. Will wait ${formatNumber(ms / 1000)} seconds before retrying`);
            await sleep(ms);
            return true;
        }
    }
}

const LABELS_REGEX: RegExp = /(\[.+?])*/g;
export const parseLabels = (log: string): string[] => {
    return Array.from(log.matchAll(LABELS_REGEX), m => m[0]).map(x => x.substring(1, x.length - 1));
}

const SUBREDDIT_NAME_LOG_REGEX: RegExp = /{(.+?)}/;
export const parseSubredditLogName = (val:string): string | undefined => {
    const matches = val.match(SUBREDDIT_NAME_LOG_REGEX);
    if (matches === null) {
        return undefined;
    }
    return matches[1] as string;
}

export const LOG_LEVEL_REGEX: RegExp = /\s*(debug|warn|info|error|verbose)\s*:/i
export const isLogLineMinLevel = (line: string, minLevelText: string): boolean => {
    const lineLevelMatch = line.match(LOG_LEVEL_REGEX);
    if (lineLevelMatch === null) {
        return false;
    }

    // @ts-ignore
    const minLevel = logLevels[minLevelText];
    // @ts-ignore
    const level = logLevels[lineLevelMatch[1] as string];
    return level <= minLevel;
}

// https://regexr.com/3e6m0
const HYPERLINK_REGEX: RegExp = /(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/;
export const formatLogLineToHtml = (val: string) => {
    return val
        .replace(/(\s*debug\s*):/i, '<span class="debug text-pink-400">$1</span>:')
        .replace(/(\s*warn\s*):/i, '<span class="warn text-yellow-400">$1</span>:')
        .replace(/(\s*info\s*):/i, '<span class="info text-blue-300">$1</span>:')
        .replace(/(\s*error\s*):/i, '<span class="error text-red-400">$1</span>:')
        .replace(/(\s*verbose\s*):/i, '<span class="error text-purple-400">$1</span>:')
        .replace('\n', '<br />')
        .replace(HYPERLINK_REGEX, '<a href="$&">$&</a>');
}

export const filterLogBySubreddit = (rawLogs: string[] = [], subreddits: string[] = [], minLevel: string, isOperator = false, user?: string): any => {
    const subMap: Map<string, string[]> = new Map([['all', []]]);
    const logs = rawLogs.filter(x => isLogLineMinLevel(x, minLevel));
    if (isOperator) {
        subMap.set('all', logs.map(formatLogLineToHtml));
    }
    return logs.reduce((acc: Map<string, string[]>, curr) => {
        const subName = parseSubredditLogName(curr);
        if (subName === undefined) {
            return acc;
        }
        const formatted = formatLogLineToHtml(curr);
        const sub = subreddits.find(x => subName === x);
        const isUser = user !== undefined && subName.includes(user);
        if(!isUser) {
            if (sub === undefined) {
                return acc;
            } else if (!acc.has(sub)) {
                acc.set(sub, []);
            }
            const subLogs = acc.get(sub) as string[];
            acc.set(sub, subLogs.concat(formatted));
        }
        if (!isOperator) {
            acc.set('all', (acc.get('all') as string[]).concat(formatted));
        }
        return acc;
    }, subMap);
}

export const logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    trace: 5,
    silly: 6
};

export const pollingInfo = (opt: PollingOptionsStrong) => {
    return `${opt.pollOn.toUpperCase()} every ${opt.interval} seconds${opt.delayUntil !== undefined ? ` | wait until Activity is ${opt.delayUntil} seconds old` : ''} | maximum of ${opt.limit} Activities`
}

export const totalFromMapStats = (val: Map<any, number>): number => {
    return Array.from(val.entries()).reduce((acc: number, [k, v]) => {
        return acc + v;
    }, 0);
}

export const permissions = [
    'edit',
    'flair',
    'history',
    'identity',
    'modcontributors',
    'modflair',
    'modposts',
    'modself',
    'mysubreddits',
    'read',
    'report',
    'submit',
    'wikiread',
    'wikiedit'
];
