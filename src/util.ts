import winston, {Logger} from "winston";
import jsonStringify from 'safe-stable-stringify';
import dayjs, {Dayjs, OpUnitType} from 'dayjs';
import {FormattedRuleResult, isRuleSetResult, RulePremise, RuleResult, RuleSetResult} from "./Rule";
import deepEqual from "fast-deep-equal";
import {Duration} from 'dayjs/plugin/duration.js';
import Ajv from "ajv";
import {InvalidOptionArgumentError} from "commander";
import Submission from "snoowrap/dist/objects/Submission";
import {Comment} from "snoowrap";
import {inflateSync, deflateSync} from "zlib";
import pixelmatch from 'pixelmatch';
import {
    ActivityWindowCriteria,
    CacheOptions,
    CacheProvider,
    DurationComparison,
    GenericComparison,
    HistoricalStats,
    HistoricalStatsDisplay, ImageComparisonResult,
    //ImageData,
    ImageDetection,
    //ImageDownloadOptions,
    LogInfo,
    NamedGroup,
    PollingOptionsStrong,
    RedditEntity,
    RedditEntityType,
    RegExResult,
    ResembleResult,
    ResourceStats,
    StatusCodeError,
    StringOperator,
    StrongSubredditState,
    SubredditState
} from "./Common/interfaces";
import JSON5 from "json5";
import yaml, {JSON_SCHEMA} from "js-yaml";
import SimpleError from "./Utils/SimpleError";
import InvalidRegexError from "./Utils/InvalidRegexError";
import {constants, promises} from "fs";
import {cacheOptDefaults} from "./Common/defaults";
import cacheManager, {Cache} from "cache-manager";
import redisStore from "cache-manager-redis-store";
import crypto from "crypto";
import Autolinker from 'autolinker';
import {create as createMemoryStore} from './Utils/memoryStore';
import {MESSAGE} from "triple-beam";
import {RedditUser} from "snoowrap/dist/objects";
import reRegExp from '@stdlib/regexp-regexp';
import fetch, {Response} from "node-fetch";
import { URL } from "url";
import ImageData from "./Common/ImageData";
import {Sharp, SharpOptions} from "sharp";

const ReReg = reRegExp();

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

export const defaultFormat = (defaultLabel = 'App') => printf(({
                                                                   level,
                                                                   message,
                                                                   labels = [defaultLabel],
                                                                   subreddit,
                                                                   bot,
                                                                   instance,
                                                                   leaf,
                                                                   itemId,
                                                                   timestamp,
                                                                   durationMs,
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
        if (msg === undefined || msg === null || typeof message === 'object') {
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

    return `${timestamp} ${level.padEnd(7)}: ${instance !== undefined ? `|${instance}| ` : ''}${bot !== undefined ? `~${bot}~ ` : ''}${subreddit !== undefined ? `{${subreddit}} ` : ''}${labelContent} ${msg}${durationMs !== undefined ? ` Elapsed: ${durationMs}ms (${formatNumber(durationMs/1000)}s) ` : ''}${stringifyValue !== '' ? ` ${stringifyValue}` : ''}${stackMsg}`;
});


export const labelledFormat = (labelName = 'App') => {
    //const l = label({label: labelName, message: false});
    return combine(
        timestamp(
            {
                format: () => dayjs().local().format(),
            }
        ),
      // l,
        s,
        errorAwareFormat,
        //errorsFormat,
        defaultFormat(labelName),
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

export const parseBoolWithDefault = (defaultValue: any) => (arg: any, prevVal: any) => {
    parseBool(arg, defaultValue)
};

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

export const REDDIT_ENTITY_REGEX: RegExp = /^\s*(?<entityType>\/[ru]\/|[ru]\/)*(?<name>\w+)*\s*$/;
export const REDDIT_ENTITY_REGEX_URL = 'https://regexr.com/65r9b';
export const parseRedditEntity = (val:string): RedditEntity => {
    const matches = val.match(REDDIT_ENTITY_REGEX);
    if (matches === null) {
        throw new InvalidRegexError(REDDIT_ENTITY_REGEX, val, REDDIT_ENTITY_REGEX_URL)
    }
    const groups = matches.groups as any;
    let eType: RedditEntityType = 'user';
    if(groups.entityType !== undefined && typeof groups.entityType === 'string' && groups.entityType.includes('r')) {
        eType = 'subreddit';
    }
    return {
        name: groups.name,
        type: eType,
    }
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
            if (err.statusCode === undefined || ([401, 500, 503, 502, 504, 522].includes(err.statusCode))) {
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

export const parseALogName = (reg: RegExp) => (val: string): string | undefined => {
    const matches = val.match(reg);
    if (matches === null) {
        return undefined;
    }
    return matches[1] as string;
}

const SUBREDDIT_NAME_LOG_REGEX: RegExp = /{(.+?)}/;
export const parseSubredditLogName = parseALogName(SUBREDDIT_NAME_LOG_REGEX);
export const parseSubredditLogInfoName = (logInfo: LogInfo) => logInfo.subreddit;
const BOT_NAME_LOG_REGEX: RegExp = /~(.+?)~/;
export const parseBotLogName = parseALogName(BOT_NAME_LOG_REGEX);
const INSTANCE_NAME_LOG_REGEX: RegExp = /\|(.+?)\|/;
export const parseInstanceLogName = parseALogName(INSTANCE_NAME_LOG_REGEX);
export const parseInstanceLogInfoName = (logInfo: LogInfo) => logInfo.instance;

export const LOG_LEVEL_REGEX: RegExp = /\s*(debug|warn|info|error|verbose)\s*:/i
export const isLogLineMinLevel = (log: string | LogInfo, minLevelText: string): boolean => {
    // @ts-ignore
    const minLevel = logLevels[minLevelText];
    let level: number;

    if(typeof log === 'string') {
        const lineLevelMatch =  log.match(LOG_LEVEL_REGEX)
        if (lineLevelMatch === null) {
            return false;
        }
        // @ts-ignore
         level = logLevels[lineLevelMatch[1]];
    } else {
        const lineLevelMatch = log.level;
        // @ts-ignore
        level = logLevels[lineLevelMatch];
    }
    return level <= minLevel;
}

// https://regexr.com/3e6m0
const HYPERLINK_REGEX: RegExp = /(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/;
export const formatLogLineToHtml = (log: string | LogInfo) => {
    const val = typeof log === 'string' ? log : log[MESSAGE];
    const logContent = Autolinker.link(val, {
        email: false,
        phone: false,
        mention: false,
        hashtag: false,
        stripPrefix: false,
        sanitizeHtml: true,
    })
        .replace(/(\s*debug\s*):/i, '<span class="debug text-pink-400">$1</span>:')
        .replace(/(\s*warn\s*):/i, '<span class="warn text-yellow-400">$1</span>:')
        .replace(/(\s*info\s*):/i, '<span class="info text-blue-300">$1</span>:')
        .replace(/(\s*error\s*):/i, '<span class="error text-red-400">$1</span>:')
        .replace(/(\s*verbose\s*):/i, '<span class="error text-purple-400">$1</span>:')
        .replaceAll('\n', '<br />');
        //.replace(HYPERLINK_REGEX, '<a target="_blank" href="$&">$&</a>');
    return `<div class="logLine">${logContent}</div>`
}

export type LogEntry = [number, LogInfo];
export interface LogOptions {
    limit: number,
    level: string,
    sort: 'ascending' | 'descending',
    operator?: boolean,
    user?: string,
    allLogsParser?: Function
    allLogName?: string
}

export const filterLogBySubreddit = (logs: Map<string, LogEntry[]>, validLogCategories: string[] = [], options: LogOptions): Map<string, string[]> => {
    const {
        limit,
        level,
        sort,
        operator = false,
        user,
        allLogsParser = parseSubredditLogInfoName,
        allLogName = 'app'
    } = options;

    // get map of valid logs categories
    const validSubMap: Map<string, LogEntry[]> = new Map();
    for(const [k, v] of logs) {
        if(validLogCategories.includes(k)) {
            validSubMap.set(k, v);
        }
    }

    // derive 'all'
    let allLogs = (logs.get(allLogName) || []);
    if(!operator) {
        // if user is not an operator then we want to filter allLogs to only logs that include categories they can access
        if(user === undefined) {
            allLogs = [];
        } else {
            allLogs.filter(([time, l]) => {
                const sub = allLogsParser(l);
                return sub !== undefined && sub.includes(user);
            });
        }
    }
    // then append all other logs to all logs
    // -- this is fine because we sort and truncate all logs just below this anyway
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
    'identity',
    'history',
    'read',
    'modcontributors',
    'modflair',
    'modlog',
    'modmail',
    'privatemessages',
    'modposts',
    'modself',
    'mysubreddits',
    'report',
    'submit',
    'wikiread',
    'wikiedit',
];

export const boolToString = (val: boolean): string => {
    return val ? 'Yes' : 'No';
}

export const isRedditMedia = (act: Comment | Submission): boolean => {
    return asSubmission(act) && (act.is_reddit_media_domain || act.is_video || ['v.redd.it','i.redd.it'].includes(act.domain));
}

export const isExternalUrlSubmission = (act: Comment | Submission): boolean => {
    return asSubmission(act) && !act.is_self && !isRedditMedia(act);
}

export const parseStringToRegex = (val: string, defaultFlags?: string): RegExp | undefined => {
    const result = ReReg.exec(val);
    if (result === null) {
        return undefined;
    }
    // index 0 => full string
    // index 1 => regex without flags and forward slashes
    // index 2 => flags
    const flags = result[2] === '' ? (defaultFlags || '') : result[2];
    return new RegExp(result[1], flags);
}

export const parseRegex = (reg: RegExp, val: string): RegExResult => {

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

export const isStrongSubredditState = (value: SubredditState | StrongSubredditState) => {
    return value.name === undefined || value.name instanceof RegExp;
}

export const asStrongSubredditState = (value: any): value is StrongSubredditState => {
    return isStrongSubredditState(value);
}

export interface StrongSubredditStateOptions {
    defaultFlags?: string
    generateDescription?: boolean
}

export const toStrongSubredditState = (s: SubredditState, opts?: StrongSubredditStateOptions): StrongSubredditState => {
    const {defaultFlags, generateDescription = false} = opts || {};
    const {name: nameValRaw, stateDescription} = s;

    let nameReg: RegExp | undefined;
    if (nameValRaw !== undefined) {
        if (!(nameValRaw instanceof RegExp)) {
            let nameVal = nameValRaw.trim();
            nameReg = parseStringToRegex(nameVal, defaultFlags);
            if (nameReg === undefined) {
                try {
                    const parsedVal = parseSubredditName(nameVal);
                    nameVal = parsedVal;
                } catch (err) {
                    // oh well
                    const f = 1;
                }
                nameReg = parseStringToRegex(`/^${nameVal}$/`, defaultFlags);
            }
        } else {
            nameReg = nameValRaw;
        }
    }
    const strongState = {
        ...s,
        name: nameReg
    };

    if (generateDescription && stateDescription === undefined) {
        strongState.stateDescription = objectToStringSummary(strongState);
    }

    return strongState;
}

export async function readConfigFile(path: string, opts: any) {
    const {log, throwOnNotFound = true} = opts;
    try {
        await promises.access(path, constants.R_OK);
        const data = await promises.readFile(path);
        const [configObj, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(data as unknown as string);
        if(configObj !== undefined) {
            return configObj as object;
        }
        log.error(`Could not parse wiki page contents as JSON or YAML:`);
        log.error(jsonErr);
        log.error(yamlErr);
        throw new SimpleError('Could not parse wiki page contents as JSON or YAML');
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

const timestampArr = () => {
    const arr: number[] = [];
    arr.length = 50;
    return arr;
}

const statMetricCache = () => {
    return cacheManager.caching({store: 'memory', max: 50, ttl: 0});
}

export const cacheStats = (): ResourceStats => {
    return {
        author: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        authorCrit: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        itemCrit: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        subredditCrit: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        content: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        userNotes: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        submission: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        comment: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        subreddit: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        commentCheck: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0}
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

export const createCacheManager = (options: CacheOptions): Cache => {
    const {store, max, ttl = 60, host = 'localhost', port, auth_pass, db, ...rest} = options;
    switch (store) {
        case 'none':
            return cacheManager.caching({store: 'none', max, ttl});
        case 'redis':
            return cacheManager.caching({
                store: redisStore,
                host,
                port,
                auth_pass,
                db,
                ttl,
                ...rest,
            });
        case 'memory':
        default:
            //return cacheManager.caching({store: 'memory', max, ttl});
            return cacheManager.caching({store: {create: createMemoryStore}, max, ttl, shouldCloneBeforeSet: false});
    }
}

export const randomId = () => crypto.randomBytes(20).toString('hex');

export const intersect = (a: Array<any>, b: Array<any>) => {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    return Array.from(intersection);
}

export const snooLogWrapper = (logger: Logger) => {
    return {
        warn: (...args: any[]) => logger.warn(args.slice(0, 2).join(' '), [args.slice(2)]),
        debug: (...args: any[]) => logger.debug(args.slice(0, 2).join(' '), [args.slice(2)]),
        info: (...args: any[]) => logger.info(args.slice(0, 2).join(' '), [args.slice(2)]),
        trace: (...args: any[]) => logger.debug(args.slice(0, 2).join(' '), [args.slice(2)]),
    }
}

export const isScopeError = (err: any): boolean => {
    if(typeof err === 'object' && err.name === 'StatusCodeError' && err.response !== undefined) {
        const authHeader = err.response.headers['www-authenticate'];
        return authHeader !== undefined && authHeader.includes('insufficient_scope');
    }
    return false;
}

export const isStatusError = (err: any): err is StatusCodeError => {
    return typeof err === 'object' && err.name === 'StatusCodeError' && err.response !== undefined;
}

/**
 * Cached activities lose type information when deserialized so need to check properties as well to see if the object is the shape of a Submission
 * */
export const isSubmission = (value: any) => {
    return value instanceof Submission || value.domain !== undefined;
}

export const asSubmission = (value: any): value is Submission => {
    return isSubmission(value);
}

/**
 * Serialized activities store subreddit and user properties as their string representations (instead of proxy)
 * */
export const getActivitySubredditName = (activity: any): string => {
    if(typeof activity.subreddit === 'string') {
        return activity.subreddit;
    }
    return activity.subreddit.display_name;
}

/**
 * Serialized activities store subreddit and user properties as their string representations (instead of proxy)
 * */
export const getActivityAuthorName = (author: RedditUser | string): string => {
    if(typeof author === 'string') {
        return author;
    }
    return author.name;
}

export const buildCachePrefix = (parts: any[]): string => {
    const prefix = parts.filter(x => typeof x === 'string' && x !== '').map(x => x.trim()).map(x => x.split(':')).flat().filter(x => x !== '').join(':')
    if(prefix !== '') {
        return `${prefix}:`;
    }
    return prefix;
}

export const objectToStringSummary = (obj: object): string => {
    const parts = [];
    for(const [key, val] of Object.entries(obj)) {
        parts.push(`${key}: ${val}`);
    }
    return parts.join(' | ');
}

/**
 * Returns the index of the last element in the array where predicate is true, and -1
 * otherwise.
 * @param array The source array to search in
 * @param predicate find calls predicate once for each element of the array, in descending
 * order, until it finds one where predicate returns true. If such an element is found,
 * findLastIndex immediately returns that element index. Otherwise, findLastIndex returns -1.
 *
 * @see https://stackoverflow.com/a/53187807/1469797
 */
export function findLastIndex<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): number {
    let l = array.length;
    while (l--) {
        if (predicate(array[l], l, array))
            return l;
    }
    return -1;
}

export const parseRuleResultsToMarkdownSummary = (ruleResults: RuleResult[]): string => {
    const results = ruleResults.map((y: any) => {
        const {triggered, result, name, ...restY} = y;
        let t = triggeredIndicator(false);
        if(triggered === null) {
            t = 'Skipped';
        } else if(triggered === true) {
            t = triggeredIndicator(true);
        }
        return `* ${name} - ${t} - ${result || '-'}`;
    });
    return results.join('\r\n');
}

export const isValidImageURL = (str: string): boolean => {
    return !!str.match(/\w+\.(jpg|jpeg|gif|png|tiff|bmp)$/gi);
}

let resembleCIFunc: Function;
type SharpCreate = (input?:
| Buffer
| Uint8Array
| Uint8ClampedArray
| Int8Array
| Uint16Array
| Int16Array
| Uint32Array
| Int32Array
| Float32Array
| Float64Array
| string,) => Sharp;
let sharpImg: SharpCreate;

const getCIFunc = async () => {
    if (resembleCIFunc === undefined) {
        // @ts-ignore
        const resembleModule = await import('resemblejs/compareImages');
        if (resembleModule === undefined) {
            throw new Error('Could not import resemblejs');
        }
        resembleCIFunc = resembleModule.default;
    }
    return resembleCIFunc;
}

export const getSharpAsync = async (): Promise<SharpCreate> => {
    if (sharpImg === undefined) {
        const sharpModule = await import('sharp');
        if (sharpModule === undefined) {
            throw new Error('Could not import sharp');
        }
        // @ts-ignore
        sharpImg = sharpModule.default;
    }
    return sharpImg;
}

export const compareImages = async (data1: ImageData, data2: ImageData, threshold: number, variantDimensionDiff = 0): Promise<[ImageComparisonResult, boolean, string[]]> => {
    let results: ImageComparisonResult | undefined;
    const errors = [];
    try {
        results = await pixelImageCompare(data1, data2);
    } catch (err) {
        if(!(err instanceof SimpleError)) {
            errors.push(err.message);
        }
        // swallow this and continue with resemble
    }
    if (results === undefined) {
        results = await resembleImageCompare(data1, data2, threshold, variantDimensionDiff);
    }

    return [results, results.misMatchPercentage < threshold, errors];
}

export const pixelImageCompare = async (data1: ImageData, data2: ImageData): Promise<ImageComparisonResult> => {

    let pixelDiff: number | undefined = undefined;

    let sharpFunc: SharpCreate;

    try {
        sharpFunc = await getSharpAsync();
    } catch (err) {
        err.message = `Unable to do image comparison due to an issue importing the comparison library. It is likely sharp is not installed (see ContextMod docs). Error Message: ${err.message}`;
        throw err;
    }

    if(data1.preferredResolution !== undefined) {
        const [prefWidth, prefHeight] = data1.preferredResolution;
        const prefImgData = data2.getSimilarResolutionVariant(prefWidth, prefHeight);
        if(prefImgData !== undefined) {
            const refThumbnail = data1.getSimilarResolutionVariant(prefWidth, prefHeight) as ImageData;
            // go ahead and fetch comparing image data so analysis time doesn't include download time
            await prefImgData.data();
            const [actualWidth, actualHeight] = refThumbnail.actualResolution as [number, number];
            //const normalRefData = await sharpFunc(await refThumbnail.data).normalise().ensureAlpha().raw().toBuffer({resolveWithObject: true});
            const time = Date.now();
            //pixelDiff = pixelmatch(normalRefData.data, await sharpFunc(await prefImgData.data).ensureAlpha().raw().toBuffer(), null, normalRefData.info.width, normalRefData.info.height);
            const refInfo = await (await refThumbnail.sharp()).resize(400, null, {fit: 'outside'}).raw().toBuffer({resolveWithObject: true});
            pixelDiff = pixelmatch(refInfo.data, await (await prefImgData.sharp()).resize(400, null, {fit: 'outside'}).raw().toBuffer(), null, refInfo.info.width, refInfo.info.height);
            return {
                isSameDimensions: true,
                dimensionDifference: {
                    height: 0,
                    width: 0,
                },
                misMatchPercentage: pixelDiff / (refInfo.info.width * refInfo.info.height),
                analysisTime: Date.now() - time,
            }
        }
    }
    // try to determine by provided dimensions (if any) before downloading
    if(data1.hasDimensions && data2.hasDimensions && !data1.isSameDimensions(data2)) {
        throw new SimpleError('No images have same dimensions');
    }
    // download anyway because resemblejs uses a lot of memory (15-30MB per image) vs. 2 downloads which will be ~2-5MB
    if(!data1.hasDimensions) {
        await data1.data;
    }
    if(!data2.hasDimensions) {
        await data2.data;
    }
    // should have all dimensions now
    if(!data1.isSameDimensions(data2)) {
        throw new SimpleError('No images have same dimensions');
    }
    // ok so now are sure everything is same dimensions
    const time = Date.now();
    pixelDiff = pixelmatch(await data1.data(), await data2.data(), null, data1.width as number, data2.height as number);
    return {
        isSameDimensions: true,
        dimensionDifference: {
            height: 0,
            width: 0,
        },
        misMatchPercentage: pixelDiff / (data1.pixels as number),
        analysisTime: Date.now() - time,
    }
}

export const resembleImageCompare = async (data1: ImageData, data2: ImageData, threshold?: number, variantDimensionDiff = 0): Promise<ImageComparisonResult> => {
    let ci: Function;

    try {
        ci = await getCIFunc();
    } catch (err) {
        err.message = `Unable to do image comparison due to an issue importing the comparison library. It is likely 'node-canvas' is not installed (see ContextMod docs). Error Message: ${err.message}`;
        throw err;
    }

    let results: ImageComparisonResult | undefined = undefined;
    // @ts-ignore
    let resResult: ResembleResult = undefined;

    //const [minWidth, minHeight] = getMinimumDimensions(data1, data2);
    const compareOptions = {
        // "ignore": [
        //     'colors' //  ~100% than nothing because resemble computes brightness information from rgb for each pixel
        // ],
        // boundingBox is ~30% slower than no restrictions
        // because resemble has to check that each pixel is within the box
        //
        // output: {
        //     // compare at most 800x800 section to increase performance
        //     // -- potentially allow this to be user-configurable in the future if not sufficient for dup detection
        //     boundingBox: {
        //         left: 0,
        //         top: 0,
        //         right: Math.min(minWidth, 800),
        //         bottom: Math.min(minHeight, 800)
        //     },
        // },
        returnEarlyThreshold: threshold !== undefined ? Math.min(threshold + 5, 100) : undefined,
    };

    if(data1.preferredResolution !== undefined) {
        const [prefWidth, prefHeight] = data1.preferredResolution;
        const prefImgData = data2.getSimilarResolutionVariant(prefWidth, prefHeight, variantDimensionDiff);
        if(prefImgData !== undefined) {
            resResult = await ci(await (await (data1.getSimilarResolutionVariant(prefWidth, prefHeight) as ImageData).sharp()).resize(400, null, {fit: 'outside'}).jpeg().toBuffer()
                , await (await prefImgData.sharp()).resize(400, null, {fit: 'outside'}).jpeg().toBuffer()
                , compareOptions) as ResembleResult;
        }
    }
    if(resResult === undefined) {
        resResult = await ci(await (await data1.sharp()).resize(400, null, {fit: 'outside'}).jpeg().toBuffer(),
            await (await data2.sharp()).resize(400, null, {fit: 'outside'}).jpeg().toBuffer(), compareOptions) as ResembleResult;
    }

    return {
        isSameDimensions: resResult.isSameDimensions,
        dimensionDifference: resResult.dimensionDifference,
        misMatchPercentage: resResult.rawMisMatchPercentage,
        analysisTime: resResult.analysisTime
    };
}

export const createHistoricalStatsDisplay = (data: HistoricalStats): HistoricalStatsDisplay => {
    const display: any = {};
    for(const [k, v] of Object.entries(data)) {
        if(v instanceof Map) {
            display[k] = v;
            display[`${k}Total`] = Array.from(v.values()).reduce((acc, curr) => acc + curr, 0);
        } else {
            display[k] = v;
        }
    }

    return display as HistoricalStatsDisplay;
}

/**
 * Determine if the state criteria being checked are
 * 1 ) expensive to compute or
 * 2 ) require additional api requests
 *
 * If neither then do not cache results as the number of unique keys (sub-state) increases AT LEAST linearly taking up space (especially in memory cache)
 * when they are probably not necessary to begin with
 * */
export const shouldCacheSubredditStateCriteriaResult = (state: SubredditState | StrongSubredditState): boolean => {
    // currently there are no scenarios where we need to cache results
    // since only things computed from state are comparisons for properties already cached on subreddit object
    // and regexes for name which aren't that costly
    // -- so just return false
    return false;
}

export const subredditStateIsNameOnly = (state: SubredditState | StrongSubredditState): boolean => {
    const critCount = Object.entries(state).filter(([key, val]) => {
        return val !== undefined && !['name','stateDescription'].includes(key);
    }).length;
    return critCount === 0;
}

export const absPercentDifference = (num1: number, num2: number) => {
    return Math.abs((num1 - num2) / num1) * 100;
}
