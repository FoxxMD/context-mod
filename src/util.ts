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
    ActivityWindowCriteria, CacheOptions, CacheProvider,
    DurationComparison,
    GenericComparison, NamedGroup,
    PollingOptionsStrong, RegExResult, ResourceStats,
    StringOperator
} from "./Common/interfaces";
import JSON5 from "json5";
import yaml, {JSON_SCHEMA} from "js-yaml";
import SimpleError from "./Utils/SimpleError";
import InvalidRegexError from "./Utils/InvalidRegexError";
import {constants, promises} from "fs";
import {cacheOptDefaults} from "./Common/defaults";
import cacheManager from "cache-manager";
import redisStore from "cache-manager-redis-store";
import crypto from "crypto";

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
        const {name, response, message, stack: errStack, error, statusCode} = info;
        if(name === 'StatusCodeError' && response !== undefined && response.headers !== undefined && response.headers['content-type'].includes('html')) {
            // reddit returns html even when we specify raw_json in the querystring (via snoowrap)
            // which means the html gets set as the message for the error AND gets added to the stack as the message
            // and we end up with a h u g e log statement full of noisy html >:(

            const errorSample = error.slice(0, 10);
            const messageBeforeIndex = message.indexOf(errorSample);
            let newMessage = `Status Error ${statusCode} from Reddit`;
            if(messageBeforeIndex > 0) {
                newMessage = `${message.slice(0, messageBeforeIndex)} - ${newMessage}`;
            }
            let cleanStack = errStack;

            // try to get just stacktrace by finding beginning of what we assume is the actual trace
            if(errStack) {
                cleanStack = `${newMessage}\n${errStack.slice(errStack.indexOf('at new StatusCodeError'))}`;
            }
            // now put it all together so its nice and clean
            info.message = newMessage;
            info.stack = cleanStack;
        }
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

export const parseBoolWithDefault = (defaultValue: any) => (arg: any) => parseBool(arg, defaultValue);

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

    const buffer = Buffer.from(blob, 'base64');
    const str = inflateSync(buffer).toString('utf-8');

    // @ts-ignore
    return JSON.parse(str);
}
// https://github.com/toolbox-team/reddit-moderator-toolbox/wiki/Subreddit-Wikis%3A-usernotes#working-with-the-blob
export const deflateUserNotes = (usersObject: object) => {
    const jsonString = JSON.stringify(usersObject);

    // Deflate/compress the string
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
        .replaceAll('\n', '<br />')
        .replace(HYPERLINK_REGEX, '<a target="_blank" href="$&">$&</a>');
}

export type LogEntry = [number, string];
export interface LogOptions {
    limit: number,
    level: string,
    sort: 'ascending' | 'descending',
    operator?: boolean,
    user?: string,
}

export const filterLogBySubreddit = (logs: Map<string, LogEntry[]>, subreddits: string[] = [], options: LogOptions): Map<string, string[]> => {
    const {
        limit,
        level,
        sort,
        operator = false,
        user
    } = options;

    // get map of valid subreddits
    const validSubMap: Map<string, LogEntry[]> = new Map();
    for(const [k, v] of logs) {
        if(subreddits.includes(k)) {
            validSubMap.set(k, v);
        }
    }

    // derive 'all'
    let allLogs = (logs.get('app') || []);
    if(!operator) {
        if(user === undefined) {
            allLogs = [];
        } else {
            allLogs.filter(([time, l]) => {
                const sub = parseSubredditLogName(l);
                return sub !== undefined && sub.includes(user);
            });
        }
    }
    allLogs = Array.from(validSubMap.values()).reduce((acc, logs) => {
        return acc.concat(logs);
    },allLogs);

    validSubMap.set('all', allLogs);

    const sortFunc = sort === 'ascending' ? (a: LogEntry, b: LogEntry) => a[0] - b[0] : (a: LogEntry, b: LogEntry) => b[0] - a[0];

    const preparedMap: Map<string, string[]> = new Map();
    // iterate each entry and
    // sort, filter by level, slice to limit, then map to html string
    for(const [k,v] of validSubMap.entries()) {
        let preparedEntries = v.filter(([time, l]) => isLogLineMinLevel(l, level));
        preparedEntries.sort(sortFunc);
        preparedMap.set(k, preparedEntries.slice(0, limit + 1).map(([time, l]) => formatLogLineToHtml(l)));
    }


    return preparedMap;
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

export const boolToString = (val: boolean): string => {
    return val ? 'Yes' : 'No';
}

export const isRedditMedia = (act: Submission): boolean => {
    return act.is_reddit_media_domain || act.is_video || ['v.redd.it','i.redd.it'].includes(act.domain);
}

export const isExternalUrlSubmission = (act: Comment | Submission): boolean => {
    return act instanceof Submission && !act.is_self && !isRedditMedia(act);
}

export const parseRegex = (r: string | RegExp, val: string, flags?: string): RegExResult => {

    const reg = r instanceof RegExp ? r : new RegExp(r, flags);

    if(reg.global) {
        const g = Array.from(val.matchAll(reg));
        const global = g.map(x => {
            return {
                match: x[0],
                groups: x.slice(1),
                named: x.groups,
            }
        });
        return {
            matched: g.length > 0,
            matches: g.length > 0 ? g.map(x => x[0]) : [],
            global: g.length > 0 ? global : [],
        };
    }

    const m = val.match(reg)
    return {
        matched: m !== null,
        matches: m !== null ? m.slice(0) : [],
        global: [],
    }
}

export async function readJson(path: string, opts: any) {
    const {log, throwOnNotFound = true} = opts;
    try {
        await promises.access(path, constants.R_OK);
        const data = await promises.readFile(path);
        return JSON.parse(data as unknown as string);
    } catch (e) {
        const {code} = e;
        if (code === 'ENOENT') {
            if (throwOnNotFound) {
                if (log) {
                    log.warn('No file found at given path', {filePath: path});
                }
                throw e;
            } else {
                return;
            }
        } else if (log) {
            log.warn(`Encountered error while parsing file`, {filePath: path});
            log.error(e);
        }
        throw e;
    }
}

// export function isObject(item: any): boolean {
//     return (item && typeof item === 'object' && !Array.isArray(item));
// }

export const overwriteMerge = (destinationArray: any[], sourceArray: any[], options: any): any[] => sourceArray;

export const removeUndefinedKeys = (obj: any) => {
    let newObj: any = {};
    Object.keys(obj).forEach((key) => {
        if(Array.isArray(obj[key])) {
            newObj[key] = obj[key];
        } else if (obj[key] === Object(obj[key])) {
            newObj[key] = removeUndefinedKeys(obj[key]);
        } else if (obj[key] !== undefined) {
            newObj[key] = obj[key];
        }
    });
    if(Object.keys(newObj).length === 0) {
        return undefined;
    }
    Object.keys(newObj).forEach(key => {
        if(newObj[key] === undefined || (null !== newObj[key] && typeof newObj[key] === 'object' && Object.keys(newObj[key]).length === 0)) {
            delete newObj[key]
        }
    });
    //Object.keys(newObj).forEach(key => newObj[key] === undefined || newObj[key] && delete newObj[key])
    return newObj;
}

export const cacheStats = (): ResourceStats => {
    return {
        author: {requests: 0, miss: 0},
        authorCrit: {requests: 0, miss: 0},
        content: {requests: 0, miss: 0},
        userNotes: {requests: 0, miss: 0},
    };
}

export const buildCacheOptionsFromProvider = (provider: CacheProvider | any): CacheOptions => {
    if(typeof provider === 'string') {
        return {
            store: provider as CacheProvider,
            ...cacheOptDefaults
        }
    }
    return {
        store: 'memory',
        ...cacheOptDefaults,
        ...provider,
    }
}

export const createCacheManager = (options: CacheOptions) => {
    const {store, max, ttl = 60, host = 'localhost', port, auth_pass, db} = options;
    switch (store) {
        case 'none':
            return undefined;
        case 'redis':
            return cacheManager.caching({
                store: redisStore,
                host,
                port,
                auth_pass,
                db,
                ttl
            });
        case 'memory':
        default:
            return cacheManager.caching({store: 'memory', max, ttl});
    }
}

export const randomId = () => crypto.randomBytes(20).toString('hex');
