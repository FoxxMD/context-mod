import winston, {Logger} from "winston";
import jsonStringify from 'safe-stable-stringify';
import dayjs, {Dayjs, OpUnitType} from 'dayjs';
import {UserNoteCriteria} from "./Rule";
import deepEqual from "fast-deep-equal";
import {Duration} from 'dayjs/plugin/duration.js';
import Ajv from "ajv";
import {InvalidOptionArgumentError} from "commander";
import {deflateSync, inflateSync} from "zlib";
import pixelmatch from 'pixelmatch';
import os from 'os';
import pathUtil from 'path';
import crypto, {createHash} from 'crypto';
import {
    ActionResult, ActivityDispatch, ActivityDispatchConfig,
    ActivitySource, ActivitySourceTypes,
    ActivityWindowCriteria,
    ActivityWindowType,
    CacheOptions,
    CacheProvider,
    CheckSummary,
    CommentState,
    DurationComparison,
    DurationVal,
    FilterCriteriaDefaults,
    FilterCriteriaPropertyResult,
    FilterCriteriaResult,
    FilterResult, FullNameTypes,
    GenericComparison,
    ImageComparisonResult,
    ItemCritPropHelper,
    LogInfo,
    ObjectPremise,
    OperatorJsonConfig, PermalinkRedditThings,
    PollingOptionsStrong,
    RedditEntity,
    RedditEntityType,
    RedditThing,
    RegExResult,
    RepostItem,
    RepostItemResult,
    RequiredItemCrit,
    ResourceStats,
    RuleResult,
    RuleSetResult,
    RunResult,
    SearchAndReplaceRegExp,
    StringComparisonOptions,
    StringOperator,
    StrongSubredditState,
    SubmissionState,
    SubredditState,
    TypedActivityState,
    TypedActivityStates
} from "./Common/interfaces";
import {Document as YamlDocument} from 'yaml'
import InvalidRegexError from "./Utils/InvalidRegexError";
import {constants, promises} from "fs";
import {cacheOptDefaults, VERSION} from "./Common/defaults";
import cacheManager, {Cache} from "cache-manager";
import redisStore from "cache-manager-redis-store";
import Autolinker from 'autolinker';
import {create as createMemoryStore} from './Utils/memoryStore';
import {LEVEL, MESSAGE} from "triple-beam";
import {Comment, RedditUser, Submission} from "snoowrap/dist/objects";
import reRegExp from '@stdlib/regexp-regexp';
import fetch from "node-fetch";
import ImageData from "./Common/ImageData";
import {Sharp, SharpOptions} from "sharp";
import {ErrorWithCause, stackWithCauses} from "pony-cause";
import {ConfigFormat} from "./Common/types";
import stringSimilarity from 'string-similarity';
import calculateCosineSimilarity from "./Utils/StringMatching/CosineSimilarity";
import levenSimilarity from "./Utils/StringMatching/levenSimilarity";
import {isRateLimitError, isRequestError, isScopeError, isStatusError, SimpleError} from "./Utils/Errors";
import JsonConfigDocument from "./Common/Config/JsonConfigDocument";
import YamlConfigDocument from "./Common/Config/YamlConfigDocument";
import AbstractConfigDocument, {ConfigDocumentInterface} from "./Common/Config/AbstractConfigDocument";
import {AuthorOptions} from "./Author/Author";
import merge from "deepmerge";
import {RulePremise} from "./Common/Entities/RulePremise";
import {RuleResultEntity as RuleResultEntity} from "./Common/Entities/RuleResultEntity";
import {nanoid} from "nanoid";
import {Rule} from "./Common/Entities/Rule";


//import {ResembleSingleCallbackComparisonResult} from "resemblejs";

// want to guess how many concurrent image comparisons we should be doing
// assuming, conservatively and based on real-world results, that comparing 30 images takes about ~30MB memory...
// and we really want to use less than a fourth of available ram (should be low-footprint!)...
// and base-line operation of RCB is usually around 40MB (liberal)
const availMemory = (os.freemem() / (1024 * 1024)) / 4 + 40;
export const imageCompareMaxConcurrencyGuess = Math.min(3, Math.max(Math.floor(availMemory/30), 1));


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
    transform: (einfo: any, {stack = true}: any = {}) => {

        // because winston logger.child() re-assigns its input to an object ALWAYS the object we recieve here will never actually be of type Error
        const includeStack = stack && (!isProbablyError(einfo, 'simpleerror') && !isProbablyError(einfo.message, 'simpleerror'));

        if (!isProbablyError(einfo.message) && !isProbablyError(einfo)) {
            return einfo;
        }

        let info: any = {};

        if (isProbablyError(einfo)) {
            const tinfo = transformError(einfo);
            info = Object.assign({}, tinfo, {
                // @ts-ignore
                level: einfo.level,
                // @ts-ignore
                [LEVEL]: einfo[LEVEL] || einfo.level,
                message: tinfo.message,
                // @ts-ignore
                [MESSAGE]: tinfo[MESSAGE] || tinfo.message
            });
            if(includeStack) {
                // so we have to create a dummy error and re-assign all error properties from our info object to it so we can get a proper stack trace
                const dummyErr = new ErrorWithCause('');
                const names = Object.getOwnPropertyNames(tinfo);
                for(const k of names) {
                    if(dummyErr.hasOwnProperty(k) || k === 'cause') {
                        // @ts-ignore
                        dummyErr[k] = tinfo[k];
                    }
                }
                // @ts-ignore
                info.stack = stackWithCauses(dummyErr);
            }
        } else {
            const err = transformError(einfo.message);
            info = Object.assign({}, einfo, err);
            // @ts-ignore
            info.message = err.message;
            // @ts-ignore
            info[MESSAGE] = err.message;

            if(includeStack) {
                const dummyErr = new ErrorWithCause('');
                // Error properties are not enumerable
                // https://stackoverflow.com/a/18278145/1469797
                const names = Object.getOwnPropertyNames(err);
                for(const k of names) {
                    if(dummyErr.hasOwnProperty(k) || k === 'cause') {
                        // @ts-ignore
                        dummyErr[k] = err[k];
                    }
                }
                // @ts-ignore
                info.stack = stackWithCauses(dummyErr);
            }
        }

        // remove redundant message from stack and make stack causes easier to read
        if(info.stack !== undefined) {
            let cleanedStack = info.stack.replace(info.message, '');
            cleanedStack = `${cleanedStack}`;
            cleanedStack = cleanedStack.replaceAll('caused by:', '\ncaused by:');
            info.stack = cleanedStack;
        }

        return info;
    }
}

const isProbablyError = (val: any, errName = 'error') => {
    return typeof val === 'object' && val.name !== undefined && val.name.toLowerCase().includes(errName);
}

export const PASS = '✓';
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

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

export const parseRedditThingsFromLink = (val: string): PermalinkRedditThings => {
    const commentId = commentReg(val);
    const submissionId = submissionReg(val);
    let comment: RedditThing | undefined;
    let submission: RedditThing | undefined;

    if (commentId !== undefined) {
        comment = {
            val: `t1_${commentId}`,
            type: 'comment',
            prefix: 't1',
            id: commentId
        }
    }
    if (submissionId !== undefined) {
        submission = {
            val: `t3_${submissionId}`,
            type: 'submission',
            prefix: 't3',
            id: submissionId
        }
    }
    return {
        submission,
        comment
    }
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const findResultByPremise = (premise: RulePremise, results: RuleResultEntity[]): (RuleResultEntity | undefined) => {
    if (results.length === 0) {
        return undefined;
    }
    return results.find(x => x.premise.configHash === premise.configHash);
}

export const determineNewResults = (existing: RuleResultEntity[], val: RuleResultEntity | RuleResultEntity[]): RuleResultEntity[] => {
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
        const relevantExisting = combined.filter(x => x.premise.rule.kind.name === result.premise.rule.kind.name).find(x => x.premise.configHash === result.premise.configHash);
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

export const removeFromSourceIfKeysExistsInDestination = (destinationArray: any[], sourceArray: any[], options: any): any[] => {
    // get all keys from objects in destination
    const destKeys = destinationArray.reduce((acc: string[], curr) => {
        // can only get keys for objects, skip for everything else
        if(curr !== null && typeof curr === 'object') {
            const keys = Object.keys(curr).map(x => x.toLowerCase());
            for(const k of keys) {
                if(!acc.includes(k)) {
                    acc.push(k);
                }
            }
        }
        return acc;
    }, []);
    const sourceItemsToKeep = sourceArray.filter(x => {
        if(x !== null && typeof x === 'object') {
            const sourceKeys = Object.keys(x).map(x => x.toLowerCase());
            // only keep if keys from this object do not appear anywhere in destination items
            return intersect(sourceKeys, destKeys).length === 0;
        }
        // keep if item is not an object since we can't test for keys anyway
        return true;
    });
    return sourceItemsToKeep.concat(destinationArray);
}

export const ruleNamesFromResults = (results: RuleResult[]) => {
    return results.map(x => x.name || x.premise.kind).join(' | ')
}

export const triggeredIndicator = (val: boolean | null, nullResultIndicator = '-'): string => {
    if(val === null) {
        return nullResultIndicator;
    }
    return val ? PASS : FAIL;
}

export const isRuleSetResult = (obj: any): obj is RuleSetResult => {
    return typeof obj === 'object' && Array.isArray(obj.results) && obj.condition !== undefined && obj.triggered !== undefined;
}

export const resultsSummary = (results: (RuleResultEntity|RuleSetResult)[], topLevelCondition: 'OR' | 'AND'): string => {
    const parts: string[] = results.map((x) => {
        if(isRuleSetResult(x)) {
            return `${triggeredIndicator(x.triggered)} (${resultsSummary(x.results, x.condition)}${x.results.length === 1 ? ` [${x.condition}]` : ''})`;
        }
        const res = x as RuleResultEntity;
        return `${triggeredIndicator(res.triggered ?? null)} ${Rule.getFriendlyIdentifier(res.premise.rule)}`;
    });
    return parts.join(` ${topLevelCondition} `)
    //return results.map(x => x.name || x.premise.kind).join(' | ')
}

export const filterCriteriaSummary = <T>(val: FilterCriteriaResult<T>): [string, string[]] => {
    // summarize properties relevant to result
    const passedProps = {props: val.propertyResults.filter(x => x.passed === true), name: 'Passed'};
    const failedProps = {props: val.propertyResults.filter(x => x.passed === false), name: 'Failed'};
    const skippedProps = {props: val.propertyResults.filter(x => x.passed === null), name: 'Skipped'};
    const dnrProps = {props: val.propertyResults.filter(x => x.passed === undefined), name: 'DNR'};

    const propSummary = [passedProps, failedProps];
    if (skippedProps.props.length > 0) {
        propSummary.push(skippedProps);
    }
    if (dnrProps.props.length > 0) {
        propSummary.push(dnrProps);
    }
    const propSummaryStrArr = propSummary.map(x => `${x.props.length} ${x.name}${x.props.length > 0 ? ` (${x.props.map(y => y.property as string)})` : ''}`);
    return [propSummaryStrArr.join(' | '), val.propertyResults.map(x => filterCriteriaPropertySummary(x, val.criteria))]
}

export const filterCriteriaPropertySummary = <T>(val: FilterCriteriaPropertyResult<T>, criteria: T): string => {
    let passResult: string;
    switch (val.passed) {
        case undefined:
            passResult = 'DNR'
            break;
        case null:
        case true:
        case false:
            passResult = triggeredIndicator(val.passed, 'Skipped');
            break;
    }
    let found;
    if(val.passed === null || val.passed === undefined) {
        found = '';
    } else if(val.property === 'submissionState') {
        const foundResult = val.found as FilterResult<SubmissionState>;
        const criteriaResults = foundResult.criteriaResults.map((x, index) => `Criteria #${index + 1} => ${triggeredIndicator(x.passed)}\n   ${x.propertyResults.map(y => filterCriteriaPropertySummary(y, x.criteria)).join('\n    ')}`).join('\n  ');
        found = `\n  ${criteriaResults}`;
    } else {
        found = ` => Found: ${val.found}`;
    }

    let expected = '';
    if(val.property !== 'submissionState') {
        let crit: T[keyof T][];
        let actualCriteria = ('criteria' in criteria) ?
            // @ts-ignore
            criteria.criteria as T
            : criteria;
        if(Array.isArray(actualCriteria[val.property])) {
            // @ts-ignore
            crit = actualCriteria[val.property];
        } else {
            crit = [actualCriteria[val.property]];
        }
        const expectedStrings = crit.map((x: any) => {
            if (asUserNoteCriteria(x)) {
                return userNoteCriteriaSummary(x);
            }
            return x;
        }).join(' OR ');
        expected = ` => Expected: ${expectedStrings}`;
    }

    return `${val.property as string} => ${passResult}${expected}${found}${val.reason !== undefined ? ` -- ${val.reason}` : ''}${val.behavior === 'exclude' ? ' (Exclude passes when Expected is not Found)' : ''}`;
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

export interface ConfigToObjectOptions {
    location?: string,
    jsonDocFunc?: (content: string, location?: string) => AbstractConfigDocument<OperatorJsonConfig>,
    yamlDocFunc?: (content: string, location?: string) => AbstractConfigDocument<YamlDocument>
}

export const parseFromJsonOrYamlToObject = (content: string, options?: ConfigToObjectOptions): [ConfigFormat, ConfigDocumentInterface<YamlDocument | object>?, Error?, Error?] => {
    let obj;
    let configFormat: ConfigFormat = 'yaml';
    let jsonErr,
        yamlErr;

    const likelyType = likelyJson5(content) ? 'json' : 'yaml';

    const {
        location,
        jsonDocFunc = (content: string, location?: string) => new JsonConfigDocument(content, location),
        yamlDocFunc = (content: string, location?: string) => new YamlConfigDocument(content, location),
    } = options || {};

    try {
        const jsonObj = jsonDocFunc(content, location);
        const output = jsonObj.toJS();
        const oType = output === null ? 'null' : typeof output;
        if (oType !== 'object') {
            jsonErr = new SimpleError(`Parsing as json produced data of type '${oType}' (expected 'object')`);
            obj = undefined;
        } else {
            obj = jsonObj;
            configFormat = 'json';
        }
    } catch (err: any) {
        jsonErr = err;
    }

    try {
        const yamlObj = yamlDocFunc(content, location)
        const output = yamlObj.toJS();
        const oType = output === null ? 'null' : typeof output;
        if (oType !== 'object') {
            yamlErr = new SimpleError(`Parsing as yaml produced data of type '${oType}' (expected 'object')`);
            obj = undefined;
        } else if (obj === undefined && (likelyType !== 'json' || yamlObj.parsed.errors.length === 0)) {
            configFormat = 'yaml';
            if(yamlObj.parsed.errors.length !== 0) {
                yamlErr = new Error(yamlObj.parsed.errors.join('\n'))
            } else {
                obj = yamlObj;
            }
        }
    } catch (err: any) {
        yamlErr = err;
    }

    if (obj === undefined) {
        configFormat = likelyType;
    }
    return [configFormat, obj, jsonErr, yamlErr];
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

export const REDDIT_ENTITY_REGEX: RegExp = /^\s*(?<entityType>\/[ru]\/|[ru]\/|u_)*(?<name>[\w-]+)*\s*$/;
export const REDDIT_ENTITY_REGEX_URL = 'https://regexr.com/6bq1g';
export const parseRedditEntity = (val:string, defaultUndefinedPrefix: RedditEntityType = 'subreddit'): RedditEntity => {
    if(val.trim().length === 0) {
        throw new Error('Entity name cannot be empty or only whitespace');
    }
    const matches = val.match(REDDIT_ENTITY_REGEX);
    if (matches === null) {
        throw new InvalidRegexError(REDDIT_ENTITY_REGEX, val, REDDIT_ENTITY_REGEX_URL)
    }
    const groups = matches.groups as any;
    let eType: RedditEntityType;
    if(groups.entityType === undefined || groups.entityType === null) {
        eType = defaultUndefinedPrefix;
    } else if(groups.entityType.includes('r')) {
        eType = 'subreddit';
    } else {
        eType = 'user';
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

export const dummyLogger = {
    debug: (v: any) => null,
    error: (v: any) => null,
    warn: (v: any) => null,
    info: (v: any) => null
}

const GIST_REGEX = new RegExp(/.*gist\.github\.com\/.+\/(.+)/i)
const GH_BLOB_REGEX = new RegExp(/.*github\.com\/(.+)\/(.+)\/blob\/(.+)/i);
const REGEXR_REGEX = new RegExp(/^.*((regexr\.com)\/[\w\d]+).*$/i);
const REGEXR_PAGE_REGEX = new RegExp(/(.|[\n\r])+"expression":"(.+)","text"/g);
export const fetchExternalUrl = async (url: string, logger: (any) = dummyLogger): Promise<string> => {
    let hadError = false;
    logger.debug(`Attempting to detect resolvable URL for ${url}`);
    let match = url.match(GIST_REGEX);
    if (match !== null) {
        const gistApiUrl = `https://api.github.com/gists/${match[1]}`;
        logger.debug(`Looks like a non-raw gist URL! Trying to resolve ${gistApiUrl}`);

        try {
            const response = await fetch(gistApiUrl);
            if (!response.ok) {
                logger.error(`Response was not OK from Gist API (${response.statusText}) -- will return response from original URL instead`);
                if (response.size > 0) {
                    logger.error(await response.text())
                }
                hadError = true;
            } else {
                const data = await response.json();
                // get first found file
                const fileKeys = Object.keys(data.files);
                if (fileKeys.length === 0) {
                    logger.error(`No files found in gist!`);
                } else {
                    if (fileKeys.length > 1) {
                        logger.warn(`More than one file found in gist! Using first found: ${fileKeys[0]}`);
                    } else {
                        logger.debug(`Using file ${fileKeys[0]}`);
                    }
                    const file = data.files[fileKeys[0]];
                    if (file.truncated === false) {
                        return file.content;
                    }
                    const rawUrl = file.raw_url;
                    logger.debug(`File contents was truncated, retrieving full contents from ${rawUrl}`);
                    try {
                        const rawUrlResponse = await fetch(rawUrl);
                        return await rawUrlResponse.text();
                    } catch (err: any) {
                        logger.error('Gist Raw URL Response returned an error, will return response from original URL instead');
                        logger.error(err);
                    }
                }
            }
        } catch (err: any) {
            logger.error('Response returned an error, will return response from original URL instead');
            logger.error(err);
        }
    }
    match = url.match(GH_BLOB_REGEX);

    if (match !== null) {
        const rawUrl = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`
        logger.debug(`Looks like a single file github URL! Resolving to ${rawUrl}`);
        try {
            const response = await fetch(rawUrl);
            if (!response.ok) {
                logger.error(`Response was not OK (${response.statusText}) -- will return response from original URL instead`);
                if (response.size > 0) {
                    logger.error(await response.text())
                }
                hadError = true;
            } else {
                return await response.text();
            }
        } catch (err: any) {
            logger.error('Response returned an error, will return response from original URL instead');
            logger.error(err);
        }
    }

    match = url.match(REGEXR_REGEX);
    if(match !== null) {
        logger.debug(`Looks like a Regexr URL! Trying to get expression from page HTML`);
        try {
            const response = await fetch(url);
            if (!response.ok) {
                if (response.size > 0) {
                    logger.error(await response.text())
                }
                throw new Error(`Response was not OK: ${response.statusText}`);
            } else {
                const page = await response.text();
                const pageMatch = [...page.matchAll(REGEXR_PAGE_REGEX)];
                if(pageMatch.length > 0) {
                    const unescaped = JSON.parse(`{"value": "${pageMatch[0][2]}"}`)
                    return unescaped.value;
                } else {
                    throw new Error('Could not parse regex expression from page HTML');
                }
            }
        } catch (err: any) {
            logger.error('Response returned an error');
            throw err;
        }
    }

    if(!hadError) {
        logger.debug('URL was not special (gist, github blob, etc...) so will retrieve plain contents');
    }
    const response = await fetch(url);
    if(!response.ok) {
        if (response.size > 0) {
            logger.error(await response.text())
        }
        throw new Error(`Response was not OK: ${response.statusText}`);
    }
    return await response.text();
}

export interface RetryOptions {
    maxRequestRetry: number,
    maxOtherRetry: number,
    waitOnRetry?: boolean,
    clearRetryCountAfter?: number,
}

export const createRetryHandler = (opts: RetryOptions, logger: Logger) => {
    const {maxRequestRetry, maxOtherRetry, waitOnRetry = true, clearRetryCountAfter = 3} = opts;

    let timeoutCount = 0;
    let otherRetryCount = 0;
    let lastErrorAt: Dayjs | undefined;

    return async (err: any): Promise<boolean> => {
        if (lastErrorAt !== undefined && dayjs().diff(lastErrorAt, 'minute') >= clearRetryCountAfter) {
            // if its been longer than 3 minutes since last error clear counters
            timeoutCount = 0;
            otherRetryCount = 0;
        }

        lastErrorAt = dayjs();

        if(isRateLimitError(err)) {
            logger.error('Will not retry because error was due to ratelimit exhaustion');
            return false;
        }

        const redditApiError = isRequestError(err) || isStatusError(err);

        if(redditApiError) {
            if (err.statusCode === undefined || ([401, 500, 503, 502, 504, 522].includes(err.statusCode))) {
                timeoutCount++;
                let msg = `Error occurred while making a request to Reddit (${timeoutCount}/${maxRequestRetry+1} in ${clearRetryCountAfter} minutes).`;
                if (timeoutCount > maxRequestRetry) {
                    logger.error(`${msg} Exceeded max allowed.`);
                    return false;
                }
                if(waitOnRetry) {
                    // exponential backoff
                    const ms = (Math.pow(2, timeoutCount - 1) + (Math.random() - 0.3) + 1) * 1000;
                    logger.warn(`${msg} Will wait ${formatNumber(ms / 1000)} seconds before retrying.`);
                    await sleep(ms);
                }
                return true;
            }
            // if it's a request error but not a known "oh probably just a reddit blip" status code treat it as other, which should usually have a lower retry max
        }

        // linear backoff
        otherRetryCount++;
        let msg = redditApiError ? `Error occurred while making a request to Reddit (${otherRetryCount}/${maxOtherRetry} in ${clearRetryCountAfter} minutes) but it was NOT a well-known "reddit blip" error.` : `Non-request error occurred (${otherRetryCount}/${maxOtherRetry} in ${clearRetryCountAfter} minutes).`;
        if (maxOtherRetry < otherRetryCount) {
            logger.warn(`${msg} Exceeded max allowed.`);
            return false;
        }
        if(waitOnRetry) {
            const ms = (4 * 1000) * otherRetryCount;
            logger.warn(`${msg} Will wait ${formatNumber(ms / 1000)} seconds before retrying`);
            await sleep(ms);
        }
        return true;
    }
}

type StringReturn = (err:any) => string;

export interface LogMatch {
    [key: string | number]: string | StringReturn
}

export interface logExceptionOptions {
    context?: string
    logIfNotMatched?: boolean
    logStackTrace?: boolean
    match?: LogMatch
}

export const parseMatchMessage = (err: any, match: LogMatch, matchTypes: (string | number)[], defaultMatch: string): [string, boolean] => {
    for(const m of matchTypes) {
        if(match[m] !== undefined) {
            if(typeof match[m] === 'string') {
                return [match[m] as string, true];
            }
            return [(match[m] as Function)(err), true];
        }
    }
    return [defaultMatch, false];
}

export const getExceptionMessage = (err: any, match: LogMatch = {}): string | undefined => {

    let matched = false,
        matchMsg;

    if (isRequestError(err)) {
        if (isRateLimitError(err)) {
            ([matchMsg, matched] = parseMatchMessage(err, match, ['ratelimit', err.statusCode], 'Ratelimit Exhausted'));
        } else if (isScopeError(err)) {
            ([matchMsg, matched] = parseMatchMessage(err, match, ['scope', err.statusCode], 'Missing OAUTH scope required for this request'));
        } else {
            ([matchMsg, matched] = parseMatchMessage(err, match, [err.statusCode], err.message));
        }
    } else {
        ([matchMsg, matched] = parseMatchMessage(err, match, ['any'], err.message));
    }

    if (matched) {
        return matchMsg;
    }
}

const _transformError = (err: Error, seen: Set<Error>, matchOptions?: LogMatch) => {
    if (!err || !isProbablyError(err)) {
        return '';
    }
    if (seen.has(err)) {
        return err;
    }

    try {

        // @ts-ignore
        let mOpts = err.matchOptions ?? matchOptions;

        if (isRequestError(err)) {
            const errMsgParts = [`Reddit responded with a NOT OK status (${err.statusCode})`];

            if (err.response.headers !== undefined && (typeof err.response.headers['content-type'] === 'string' || Array.isArray(err.response.headers['content-type'])) && err.response.headers['content-type'].includes('html')) {
                // reddit returns html even when we specify raw_json in the querystring (via snoowrap)
                // which means the html gets set as the message for the error AND gets added to the stack as the message
                // and we end up with a h u g e log statement full of noisy html >:(

                const {error, statusCode, message, stack: errStack} = err;

                let newMessage = `Status Error ${statusCode} from Reddit`;

                if (error !== undefined) {
                    if (typeof error === 'string') {
                        const errorSample = (error as unknown as string).slice(0, 10);
                        const messageBeforeIndex = message.indexOf(errorSample);
                        if (messageBeforeIndex > 0) {
                            newMessage = `${message.slice(0, messageBeforeIndex)} - ${newMessage}`;
                        }
                    } else if (error !== null && (error instanceof Error || (typeof error === 'object' && (error as any).message !== undefined))) {
                        newMessage = `${newMessage} with error: ${truncateStringToLength(100)(error.message)}`;
                    }
                } else if (message !== undefined) {
                    newMessage = `${newMessage} with message: ${truncateStringToLength(100)(message)}`;
                }
                let cleanStack = errStack;

                // try to get just stacktrace by finding beginning of what we assume is the actual trace
                if (errStack) {
                    cleanStack = `${newMessage}\n${errStack.slice(errStack.indexOf('at new StatusCodeError'))}`;
                }
                // now put it all together so its nice and clean
                err.message = newMessage;
                err.stack = cleanStack;
            }

            const msg = getExceptionMessage(err, mOpts);
            if (msg !== undefined) {
                errMsgParts.push(msg);
            }

            // we don't care about stack trace for this error because we know where it came from so truncate to two lines for now...maybe remove all together later
            if (err.stack !== undefined) {
                err.stack = err.stack.split('\n').slice(0, 2).join('\n');
            }

            const normalizedError = new ErrorWithCause(errMsgParts.join(' => '), {cause: err});
            normalizedError.stack = normalizedError.message;
            return normalizedError;
        }

        // @ts-ignore
        const cause = err.cause as unknown;

        if (cause !== undefined && cause instanceof Error) {
            // @ts-ignore
            err.cause = _transformError(cause, seen, mOpts);
        }

        return err;
    } catch (e: any) {
        // oops :(
        // we're gonna swallow silently instead of reporting to avoid any infinite nesting and hopefully the original error looks funny enough to provide clues as to what to fix here
        return err;
    }
}

export const transformError = (err: Error): any => _transformError(err, new Set());

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
const formattedTime = (short: string, full: string) => `<span class="has-tooltip"><span style="margin-top:35px" class='tooltip rounded shadow-lg p-1 bg-gray-100 text-black space-y-3 p-2 text-left'>${full}</span><span>${short}</span></span>`;
export const formatLogLineToHtml = (log: string | LogInfo, timestamp?: string) => {
    const val = typeof log === 'string' ? log : log[MESSAGE];
    const logContent = Autolinker.link(val, {
        email: false,
        phone: false,
        mention: false,
        hashtag: false,
        stripPrefix: false,
        sanitizeHtml: true,
    })
        .replace(/(\s*debug\s*):/i, '<span class="debug blue">$1</span>:')
        .replace(/(\s*warn\s*):/i, '<span class="warn yellow">$1</span>:')
        .replace(/(\s*info\s*):/i, '<span class="info green">$1</span>:')
        .replace(/(\s*error\s*):/i, '<span class="error red">$1</span>:')
        .replace(/(\s*verbose\s*):/i, '<span class="error purple">$1</span>:')
        .replaceAll('\n', '<br />');
        //.replace(HYPERLINK_REGEX, '<a target="_blank" href="$&">$&</a>');
    let line = '';

    let timestampString = timestamp;
    if(timestamp === undefined && typeof log !== 'string') {
        timestampString = (log as LogInfo).timestamp;
    }

    if(timestampString !== undefined) {
        const timeStampReplacement = formattedTime(dayjs(timestampString).format('HH:mm:ss z'), timestampString);
        const splitLine = logContent.split(timestampString);
        line = `<div class="logLine">${splitLine[0]}${timeStampReplacement}<span style="white-space: pre-wrap">${splitLine[1]}</span></div>`;
    } else {
        line = `<div style="white-space: pre-wrap" class="logLine">${logContent}</div>`
    }
    return line;
}

export type LogEntry = [number, LogInfo];
export interface LogOptions {
    limit: number | string,
    level: string,
    sort: 'ascending' | 'descending',
    operator?: boolean,
    user?: string,
    allLogsParser?: Function
    allLogName?: string,
    returnType?: 'string' | 'object'
}

export const filterLogBySubreddit = (logs: Map<string, LogEntry[]>, validLogCategories: string[] = [], options: LogOptions): Map<string, (string|LogInfo)[]> => {
    const {
        limit: limitVal,
        level,
        sort,
        operator = false,
        user,
        allLogsParser = parseSubredditLogInfoName,
        allLogName = 'app',
        returnType = 'string',
    } = options;

    let limit = typeof limitVal === 'number' ? limitVal : Number.parseInt(limitVal);
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

    const preparedMap: Map<string, (string|LogInfo)[]> = new Map();
    // iterate each entry and
    // sort, filter by level, slice to limit, then map to html string
    for(const [k,v] of validSubMap.entries()) {
        let preparedEntries = v.filter(([time, l]) => isLogLineMinLevel(l, level));
        preparedEntries.sort(sortFunc);
        const entriesSlice = preparedEntries.slice(0, limit + 1);
        if(returnType === 'string') {
            preparedMap.set(k, entriesSlice.map(([time, l]) => formatLogLineToHtml(l)));
        } else {
            preparedMap.set(k, entriesSlice.map(([time, l]) => l));
        }
    }


    return preparedMap;
}

export const logSortFunc = (sort: string = 'ascending') => sort === 'ascending' ? (a: LogInfo, b: LogInfo) => (dayjs(a.timestamp).isSameOrAfter(b.timestamp) ? 1 : -1) : (a: LogInfo, b: LogInfo) => (dayjs(a.timestamp).isSameOrBefore(b.timestamp) ? 1 : -1);

export const filterLogs= (logs: LogInfo[], options: LogOptions): LogInfo[] | string[] => {
    const {
        limit: limitVal,
        level,
        sort,
        operator = false,
        user,
        allLogsParser = parseSubredditLogInfoName,
        allLogName = 'app',
        returnType = 'string',
    } = options;

    let limit = typeof limitVal === 'number' ? limitVal : Number.parseInt(limitVal);
    let leveledLogs = logs.filter(x => isLogLineMinLevel(x, level));
    if(user !== undefined) {
        leveledLogs = logs.filter(x => x.user !== undefined && x.user === user);
    }
    leveledLogs.sort(logSortFunc(sort));
    leveledLogs = leveledLogs.slice(0, limit + 1);

    if(returnType === 'string') {
        return leveledLogs.map(x => formatLogLineToHtml(x));
    } else {
        return leveledLogs;
    }
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
    'modwiki',
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

export const testMaybeStringRegex = (test: string, subject: string, defaultFlags: string = 'i'): [boolean, string] => {
    let reg = parseStringToRegex(test, defaultFlags);
    if (reg === undefined) {
        reg = parseStringToRegex(`/.*${escapeRegex(test.trim())}.*/`, 'i');
        if (reg === undefined) {
            throw new SimpleError(`Could not convert test value to a valid regex: ${test}`);
        }
    }
    return [reg.test(subject), reg.toString()];
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
    const {defaultFlags = 'i', generateDescription = false} = opts || {};
    const {name: nameValRaw, stateDescription, isUserProfile, ...rest} = s;

    let nameValOriginallyRegex = false;

    let nameReg: RegExp | undefined;
    if (nameValRaw !== undefined) {
        if (!(nameValRaw instanceof RegExp)) {
            let nameVal = nameValRaw.trim();
            nameReg = parseStringToRegex(nameVal, defaultFlags);
            if (nameReg === undefined) {
                // if sub state has `isUserProfile=true` and config did not provide a regex then
                // assume the user wants to use the value in "name" to look for a user profile so we prefix created regex with u_
                const parsedEntity = parseRedditEntity(nameVal, isUserProfile !== undefined && isUserProfile ? 'user' : 'subreddit');
                // technically they could provide "u_Username" as the value for "name" and we will then match on it regardless of isUserProfile
                // but like...why would they do that? There shouldn't be any subreddits that start with u_ that aren't user profiles anyway(?)
                const regPrefix = parsedEntity.type === 'user' ? 'u_' : '';
                nameReg = parseStringToRegex(`/^${regPrefix}${nameVal}$/`, defaultFlags);
            } else {
                nameValOriginallyRegex = true;
            }
        } else {
            nameValOriginallyRegex = true;
            nameReg = nameValRaw;
        }
    }
    const strongState: StrongSubredditState = {
        ...rest,
        name: nameReg
    };

    // if user provided a regex for "name" then add isUserProfile so we can do a SEPARATE check on the name specifically for user profile prefix
    // -- this way user can regex for a specific name but still filter by prefix
    if(nameValOriginallyRegex) {
        strongState.isUserProfile = isUserProfile;
    }

    if (generateDescription && stateDescription === undefined) {
        strongState.stateDescription = objectToStringSummary(strongState);
    } else {
        strongState.stateDescription = stateDescription;
    }

    return strongState;
}

export const convertSubredditsRawToStrong = (x: (SubredditState | string), opts: StrongSubredditStateOptions): StrongSubredditState => {
    if (typeof x === 'string') {
        return toStrongSubredditState({name: x, stateDescription: x}, opts);
    }
    return toStrongSubredditState(x, opts);
}

export async function readConfigFile(path: string, opts: any): Promise<[string?, ConfigFormat?]> {
    const {log, throwOnNotFound = true} = opts;
    let extensionHint: ConfigFormat | undefined;
    const fileInfo = pathUtil.parse(path);
    if(fileInfo.ext !== undefined) {
        switch(fileInfo.ext) {
            case '.json':
            case '.json5':
                extensionHint = 'json';
                break;
            case '.yaml':
                extensionHint = 'yaml';
                break;
        }
    }
    try {
        await promises.access(path, constants.R_OK);
        const data = await promises.readFile(path);
        return [(data as any).toString(), extensionHint]
    } catch (e: any) {
        const {code} = e;
        if (code === 'ENOENT') {
            if (throwOnNotFound) {
                if (log) {
                    log.warn('No file found at given path', {filePath: path});
                }
                e.extension = extensionHint;
                throw e;
            } else {
                return [];
            }
        } else if (log) {
            log.warn(`Encountered error while parsing file`, {filePath: path});
            log.error(e);
        }
        e.extension = extensionHint;
        throw e;
    }
}

// export function isObject(item: any): boolean {
//     return (item && typeof item === 'object' && !Array.isArray(item));
// }

export const fileOrDirectoryIsWriteable = async (location: string) => {
    const pathInfo = pathUtil.parse(location);
    try {
        await promises.access(location, constants.R_OK | constants.W_OK);
        return true;
    } catch (err: any) {
        const {code} = err;
        if (code === 'ENOENT') {
            // file doesn't exist, see if we can write to directory in which case we are good
            try {
                await promises.access(pathInfo.dir, constants.R_OK | constants.W_OK)
                // we can write to dir
                return true;
            } catch (accessError: any) {
                // also can't access directory :(
                throw new SimpleError(`No file exists at ${location} and application does not have permission to write to that directory`);
            }
        } else {
            throw new SimpleError(`File exists at ${location} but application does have permission to write to it.`);
        }
    }
}

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
        commentCheck: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0},
        imageHash: {requests: 0, miss: 0, identifierRequestCount: statMetricCache(), requestTimestamps: timestampArr(), averageTimeBetweenHits: 'N/A', identifierAverageHit: 0}
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
/**
 * @see https://stackoverflow.com/a/64245521/1469797
 * */
function *setMinus(A: Array<any>, B: Array<any>) {
    const setA = new Set(A);
    const setB = new Set(B);

    for (const v of setB.values()) {
        if (!setA.delete(v)) {
            yield v;
        }
    }

    for (const v of setA.values()) {
        yield v;
    }
}


export const difference = (a: Array<any>, b: Array<any>) => {
    return Array.from(setMinus(a, b));
}

export const snooLogWrapper = (logger: Logger) => {
    return {
        warn: (...args: any[]) => logger.warn(args.slice(0, 2).join(' '), [args.slice(2)]),
        debug: (...args: any[]) => logger.debug(args.slice(0, 2).join(' '), [args.slice(2)]),
        info: (...args: any[]) => logger.info(args.slice(0, 2).join(' '), [args.slice(2)]),
        trace: (...args: any[]) => logger.debug(args.slice(0, 2).join(' '), [args.slice(2)]),
    }
}

/**
 * Cached activities lose type information when deserialized so need to check properties as well to see if the object is the shape of a Submission
 * */
export const isSubmission = (value: any) => {
    try {
        return value !== null && typeof value === 'object' && (value instanceof Submission || (value.name !== undefined && value.name.includes('t3_')) || value.domain !== undefined);
    } catch (e) {
        return false;
    }
}

export const asSubmission = (value: any): value is Submission => {
    return isSubmission(value);
}

export const isComment = (value: any) => {
    try {
        return value !== null && typeof value === 'object' && (value instanceof Comment || value.name.includes('t1_'));
    } catch (e) {
        return false;
    }
}

export const asComment = (value: any): value is Comment => {
    return isComment(value);
}

export const asActivity = (value: any): value is (Submission | Comment) => {
    return asComment(value) || asSubmission(value);
}

export const isUser = (value: any) => {
    try {
        return value !== null && typeof value === 'object' && (value instanceof RedditUser || value.name.includes('t2_'));
    } catch(e) {
        return false;
    }
}

export const asUser = (value: any): value is RedditUser => {
    return isUser(value);
}

export const isUserNoteCriteria = (value: any) => {
    return value !== null && typeof value === 'object' && value.type !== undefined;
}

export const asUserNoteCriteria = (value: any): value is UserNoteCriteria => {
    return isUserNoteCriteria(value);
}

export const userNoteCriteriaSummary = (val: UserNoteCriteria): string => {
    return `${val.count === undefined ? '>= 1' : val.count} of ${val.search === undefined ? 'current' : val.search} notes is ${val.type}`;
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

export const parseRuleResultsToMarkdownSummary = (ruleResults: RuleResultEntity[]): string => {
    const results = ruleResults.map((y) => {
        let name = y.premise.rule.name;
        const kind = y.premise.rule.kind.name;
        if(name === undefined) {
            name = kind;
        }
        const {triggered, result, ...restY} = y;
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
    return !!str.match(/\w+\.(jpg|jpeg|gif|png|tiff|bmp|webp)$/gi);
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
| string, options?: SharpOptions) => Sharp;
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
    const errors: string[] = [];

    results = await pixelImageCompare(data1, data2);

    // may decide to bring resemble back at some point in the future if pixelmatch has issues
    // but for now...
    // sharp is a *much* more useful utility and i'd rather have it as a dependency than node-canvas
    // it's much faster, uses less memory, and its libraries more likely to already be available on a host
    // -- with it i can control how images are normalized for dimensions which is basically what resemble was doing anyway (using canvas)

    // try {
    //     results = await pixelImageCompare(data1, data2);
    // } catch (err: any) {
    //     if(!(err instanceof SimpleError)) {
    //         errors.push(err.message);
    //     }
    //     // swallow this and continue with resemble
    // }
    // if (results === undefined) {
    //     results = await resembleImageCompare(data1, data2, threshold, variantDimensionDiff);
    // }


    return [results, results.misMatchPercentage < threshold, errors];
}

export const pixelImageCompare = async (data1: ImageData, data2: ImageData): Promise<ImageComparisonResult> => {

    let pixelDiff: number | undefined = undefined;

    let sharpFunc: SharpCreate;

    try {
        sharpFunc = await getSharpAsync();
    } catch (err: any) {
        err.message = `Unable to do image comparison due to an issue importing the comparison library. It is likely sharp is not installed (see ContextMod docs). Error Message: ${err.message}`;
        throw err;
    }

    const [refImg, compareImg, width, height] = await data1.normalizeImagesForComparison('pixel', data2);
    const time = Date.now();
    // ensureAlpha() is imperative here because pixelmatch expects an alpha layer
    pixelDiff = pixelmatch(await refImg.ensureAlpha().raw().toBuffer(), await compareImg.ensureAlpha().raw().toBuffer(), null, width, height);
    return {
        isSameDimensions: true,
        dimensionDifference: {
            height: 0,
            width: 0,
        },
        misMatchPercentage: pixelDiff / (width * height),
        analysisTime: Date.now() - time,
    }
}

// see comments in compareImages
//

// export const resembleImageCompare = async (data1: ImageData, data2: ImageData, threshold?: number, variantDimensionDiff = 0): Promise<ImageComparisonResult> => {
//     let ci: Function;
//
//     try {
//         ci = await getCIFunc();
//     } catch (err: any) {
//         err.message = `Unable to do image comparison due to an issue importing the comparison library. It is likely 'node-canvas' is not installed (see ContextMod docs). Error Message: ${err.message}`;
//         throw err;
//     }
//
//     let results: ImageComparisonResult | undefined = undefined;
//     // @ts-ignore
//     let resResult: ResembleSingleCallbackComparisonResult = undefined;
//
//     //const [minWidth, minHeight] = getMinimumDimensions(data1, data2);
//     const compareOptions = {
//         // "ignore": [
//         //     'colors' //  ~100% than nothing because resemble computes brightness information from rgb for each pixel
//         // ],
//         // boundingBox is ~30% slower than no restrictions
//         // because resemble has to check that each pixel is within the box
//         //
//         // output: {
//         //     // compare at most 800x800 section to increase performance
//         //     // -- potentially allow this to be user-configurable in the future if not sufficient for dup detection
//         //     boundingBox: {
//         //         left: 0,
//         //         top: 0,
//         //         right: Math.min(minWidth, 800),
//         //         bottom: Math.min(minHeight, 800)
//         //     },
//         // },
//         returnEarlyThreshold: threshold !== undefined ? Math.min(threshold + 5, 100) : undefined,
//     };
//
//     if(data1.preferredResolution !== undefined) {
//         const [prefWidth, prefHeight] = data1.preferredResolution;
//         const prefImgData = data2.getSimilarResolutionVariant(prefWidth, prefHeight, variantDimensionDiff);
//         if(prefImgData !== undefined) {
//             let refThumbnail;
//             try {
//                 refThumbnail = data1.getSimilarResolutionVariant(prefWidth, prefHeight) as ImageData;
//                 resResult = await ci(await (await refThumbnail.sharp()).clone().resize(400, null, {fit: 'outside'}).jpeg().toBuffer()
//                     , await (await prefImgData.sharp()).clone().resize(400, null, {fit: 'outside'}).jpeg().toBuffer()
//                     , compareOptions) as ResembleSingleCallbackComparisonResult;
//             } catch(err) {
//                 throw err;
//             }
//         }
//     }
//     if(resResult === undefined) {
//         resResult = await ci(await (await data1.sharp()).clone().resize(400, null, {fit: 'outside'}).jpeg().toBuffer(),
//             await (await data2.sharp()).clone().resize(400, null, {fit: 'outside'}).jpeg().toBuffer(), compareOptions) as ResembleSingleCallbackComparisonResult;
//     }
//
//
//     return {
//         isSameDimensions: resResult.isSameDimensions,
//         dimensionDifference: resResult.dimensionDifference,
//         // @ts-ignore
//         misMatchPercentage: resResult.rawMisMatchPercentage,
//         analysisTime: resResult.analysisTime
//     };
// }

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
        return val !== undefined && !['name','stateDescription', 'isUserProfile'].includes(key);
    }).length;
    return critCount === 0;
}

export const absPercentDifference = (num1: number, num2: number) => {
    return Math.abs((num1 - num2) / num1) * 100;
}

export const bitsToHexLength = (bits: number): number => {
    return Math.pow(bits, 2) / 4;
}

export const escapeRegex = (val: string) => {
    return val.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export const windowToActivityWindowCriteria = (window: (Duration | ActivityWindowType | ActivityWindowCriteria)): ActivityWindowCriteria => {
    let crit: ActivityWindowCriteria;

    if (isActivityWindowCriteria(window)) {
        crit = window;
    } else if (typeof window === 'number') {
        crit = {count: window};
    } else {
        crit = {duration: window as DurationVal};
    }

    const {
        satisfyOn = 'any',
        count,
        duration,
        subreddits: {
            include = [],
            exclude = [],
        } = {},
    } = crit;

    const includes = include.map(x => parseSubredditName(x).toLowerCase());
    const excludes = exclude.map(x => parseSubredditName(x).toLowerCase());

    return {
        satisfyOn,
        count,
        duration,
        subreddits: {
            include: includes,
            exclude: excludes
        }
    }
}

export const searchAndReplace = (val: string, ops: SearchAndReplaceRegExp[]) => {
    if (ops.length === 0) {
        return val;
    }
    return ops.reduce((acc, curr) => {
        let reg = parseStringToRegex(curr.search, 'ig');
        if (reg === undefined) {
            reg = parseStringToRegex(`/.*${escapeRegex(curr.search.trim())}.*/`, 'ig');
        }
        return acc.replace(reg ?? val, curr.replace);
    }, val);
}

export const isRepostItemResult = (val: (RepostItem|RepostItemResult)): val is RepostItemResult => {
    return 'sameness' in val;
}

export const defaultStrCompareTransformFuncs = [
    // lower case to remove case sensitivity
    (str: string) => str.toLocaleLowerCase(),
    // remove excess whitespace
    (str: string) => str.trim(),
    // remove non-alphanumeric characters so that differences in punctuation don't subtract from comparison score
    (str: string) => str.replace(/[^A-Za-z0-9 ]/g, ""),
    // replace all instances of 2 or more whitespace with one whitespace
    (str: string) => str.replace(/\s{2,}|\n/g, " ")
];

const sentenceLengthWeight = (length: number) => {
    // thanks jordan :')
    // constants are black magic
    return (Math.log(length) / 0.20) - 5;
}

export const stringSameness = (valA: string, valB: string, options?: StringComparisonOptions) => {

    const {
        transforms = defaultStrCompareTransformFuncs,
    } = options || {};

    const cleanA = transforms.reduce((acc, curr) => curr(acc), valA);
    const cleanB = transforms.reduce((acc, curr) => curr(acc), valB);

    const shortest = cleanA.length > cleanB.length ? cleanB : cleanA;

    // Dice's Coefficient
    const dice = stringSimilarity.compareTwoStrings(cleanA, cleanB) * 100;
    // Cosine similarity
    const cosine = calculateCosineSimilarity(cleanA, cleanB) * 100;
    // Levenshtein distance
    const [levenDistance, levenSimilarPercent] = levenSimilarity(cleanA, cleanB);

    // use shortest sentence for weight
    const weightScore = sentenceLengthWeight(shortest.length);

    // take average score
    const highScore = (dice + cosine + levenSimilarPercent) / 3;
    // weight score can be a max of 15
    const highScoreWeighted = highScore + Math.min(weightScore, 15);
    return {
        scores: {
            dice,
            cosine,
            leven: levenSimilarPercent
        },
        highScore,
        highScoreWeighted,
    }
}

// https://stackoverflow.com/a/18679657/1469797
export const wordCount = (str: string): number => {
    return str.split(' ')
        .filter(function (n) {
            return n != ''
        })
        .length;
}

export const random = (min: number, max: number): number => (
    Math.floor(Math.random() * (max - min + 1)) + min
);

/**
 * Naively detect if a string is most likely json5
 *
 * Check if string begins with comments, opening bracket, or opening curly brace.
 * */
export const likelyJson5 = (str: string): boolean => {
    let validStart = false;
    const lines = str.split('\r\n');
    for(const line of lines) {
        const trimmedLine = line.trim();
        if(trimmedLine.indexOf('//') === 0) {
            // skip line if it starts with a comment
            continue;
        }
        // if the first non-comment line starts with an opening curly brace or bracket its ~probably~ json...
        const startChar = trimmedLine.charAt(0);
        validStart = ['{','['].some(x => x === startChar);
        break;
    }
    return validStart;
}

export const hashString = (val: any): string => {
    const hash = createHash('sha256');
    if (typeof val !== 'string') {
        hash.update(JSON.stringify(val));
    } else {
        hash.update(val);
    }
    return hash.digest('hex');
}

const defaultScanOptions = {
    COUNT: '100',
    MATCH: '*'
}
/**
 * Frankenstein redis scan generator
 *
 * Cannot use the built-in scan iterator because it is only available in > v4 of redis client but node-cache-manager-redis is using v3.x --
 * So combining the async iterator defined in v4 from here https://github.com/redis/node-redis/blob/master/packages/client/lib/client/index.ts#L587
 * with the scan example from v3 https://github.com/redis/node-redis/blob/8a43dea9bee11e41d33502850f6989943163020a/examples/scan.js
 *
 * */
export async function* redisScanIterator(client: any, options: any = {}): AsyncIterable<string> {
    let cursor: string = '0';
    const scanOpts = {...defaultScanOptions, ...options};
    do {
        const iterScan = new Promise((resolve, reject) => {
            client.scan(cursor, 'MATCH', scanOpts.MATCH, 'COUNT', scanOpts.COUNT, (err: any, res: any) => {
                if(err) {
                    return reject(err);
                } else {
                    const newCursor = res[0];
                    let keys = res[1];
                    resolve([newCursor, keys]);
                }
            });
        }) as Promise<[any, string[]]>;
        const [newCursor, keys] = await iterScan;
        cursor = newCursor;
        for (const key of keys) {
            yield key;
        }
    } while (cursor !== '0');
}

export const mergeFilters = (objectConfig: any, filterDefs: FilterCriteriaDefaults | undefined): [AuthorOptions, TypedActivityStates] => {
    const {authorIs: aisVal = {}, itemIs: iisVal = []} = objectConfig || {};
    const authorIs = aisVal as AuthorOptions;
    const itemIs = iisVal as TypedActivityStates;

    const {
        authorIsBehavior = 'merge',
        itemIsBehavior = 'merge',
        authorIs: authorIsDefault = {},
        itemIs: itemIsDefault = []
    } = filterDefs || {};

    let derivedAuthorIs: AuthorOptions = authorIsDefault;
    if (authorIsBehavior === 'merge') {
        derivedAuthorIs = merge.all([authorIs, authorIsDefault], {arrayMerge: removeFromSourceIfKeysExistsInDestination});
    } else if (Object.keys(authorIs).length > 0) {
        derivedAuthorIs = authorIs;
    }

    let derivedItemIs: TypedActivityStates = itemIsDefault;
    if (itemIsBehavior === 'merge') {
        derivedItemIs = [...itemIs, ...itemIsDefault];
    } else if (itemIs.length > 0) {
        derivedItemIs = itemIs;
    }

    return [derivedAuthorIs, derivedItemIs];
}

export const formatFilterData = (result: (RunResult | CheckSummary | RuleResult | ActionResult)) => {

    const formattedResult: any = {
        authorIs: undefined,
        itemIs: undefined
    };

    const {authorIs, itemIs} = result;

    if (authorIs !== undefined && authorIs !== null) {
        formattedResult.authorIs = {
            ...authorIs,
            passed: triggeredIndicator(authorIs.passed),
            criteriaResults: authorIs.criteriaResults.map(x => filterCriteriaSummary(x))
        }
    }
    if (itemIs !== undefined && itemIs !== null) {
        formattedResult.itemIs = {
            ...itemIs,
            passed: triggeredIndicator(itemIs.passed),
            criteriaResults: itemIs.criteriaResults.map(x => filterCriteriaSummary(x))
        }
    }

    return formattedResult;
}

export const getUserAgent = (val: string, fragment?: string) => {
    return `${replaceApplicationIdentifier(val, fragment)} (developed by /u/FoxxMD)`;
}

export const replaceApplicationIdentifier = (val: string, fragment?: string) => {
    return val.replace('{VERSION}', `v${VERSION}`).replace('{FRAG}', (fragment !== undefined ? `-${fragment}` : ''));
}

export const parseDurationValToDuration = (val: DurationVal): Duration => {
    let duration: Duration;
    if (typeof val === 'object') {
        duration = dayjs.duration(val);
        if (!dayjs.isDuration(duration)) {
            throw new Error('window value given was not a well-formed Duration object');
        }
    } else {
        try {
            duration = parseDuration(val);
        } catch (e) {
            if (e instanceof InvalidRegexError) {
                throw new Error(`duration value of '${val}' could not be parsed as a valid ISO8601 duration or DayJS duration shorthand (see Schema)`);
            }
            throw e;
        }
    }
    return duration;
}

export const generateItemFilterHelpers = (stateCriteria: TypedActivityState): [ItemCritPropHelper, RequiredItemCrit] => {
    const definedStateCriteria = (removeUndefinedKeys(stateCriteria) as RequiredItemCrit);

    if(definedStateCriteria === undefined) {
        return [{}, {} as RequiredItemCrit];
    }

    const propResultsMap = Object.entries(definedStateCriteria).reduce((acc: ItemCritPropHelper, [k, v]) => {
        const key = (k as keyof (SubmissionState & CommentState));
        acc[key] = {
            property: key,
            behavior: 'include',
        };
        return acc;
    }, {});

    return [propResultsMap, definedStateCriteria];
}

export const isCommentState = (state: TypedActivityState): state is CommentState => {
    return 'op' in state || 'depth' in state || 'submissionState' in state;
}
const DISPATCH_REGEX: RegExp = /^dispatch:/i;
const POLL_REGEX: RegExp = /^poll:/i;
export const asActivitySource = (val: string): val is ActivitySource => {
    if(['dispatch','poll','user'].some(x => x === val)) {
        return true;
    }
    return DISPATCH_REGEX.test(val) || POLL_REGEX.test(val);
}

export const strToActivitySource = (val: string): ActivitySource => {
    const cleanStr = val.trim();
    if (asActivitySource(cleanStr)) {
        return cleanStr;
    }
    throw new SimpleError(`'${cleanStr}' is not a valid ActivitySource. Must be one of: dispatch, dispatch:[identifier], poll, poll:[identifier], user`);
}

export const prefixToReddThingType = (prefix: string): FullNameTypes => {
    switch (prefix) {
        case 't1':
            return 'comment';
        case 't2':
            return 'user';
        case 't3':
            return 'submission';
        case 't4':
            return 'message';
        case 't5':
            return 'subreddit';
        default:
            throw new Error(`unrecognized prefix ${prefix}`);
    }
}

export const redditThingTypeToPrefix = (type: FullNameTypes): string => {
    switch (type) {
        case 'comment':
            return 't1';
        case 'user':
            return 't2';
        case 'submission':
            return 't3';
        case 'message':
            return 't4';
        case 'subreddit':
            return 't5';
        default:
            throw new Error(`unrecognized prefix ${type}`);
    }
}

export const REDDIT_FULLNAME_REGEX: RegExp = /^(?<prefix>t\d)_(?<id>.+)/;
export const parseRedditFullname = (str: string): RedditThing | undefined => {
    const cleanStr = str.trim();
    if (cleanStr.length === 0) {
        throw new Error('Fullname cannot be empty or only whitespace');
    }
    const matches = cleanStr.match(REDDIT_FULLNAME_REGEX);
    if (matches === null) {
        return undefined;
    }
    const groups = matches.groups as any;
    return {
        val: cleanStr,
        type: prefixToReddThingType(groups.prefix as string),
        prefix: groups.prefix as string,
        id: groups.id as string
    }
}

export const activityDispatchConfigToDispatch = (config: ActivityDispatchConfig, activity: (Comment | Submission), type: ActivitySourceTypes, action?: string): ActivityDispatch => {
    let tolerantVal: boolean | Duration | undefined;
    if (config.tardyTolerant !== undefined) {
        if (typeof config.tardyTolerant === 'boolean') {
            tolerantVal = config.tardyTolerant;
        } else {
            tolerantVal = parseDurationValToDuration(config.tardyTolerant);
        }
    }
    return {
        ...config,
        delay: parseDurationValToDuration(config.delay),
        tardyTolerant: tolerantVal,
        queuedAt: dayjs().utc(),
        processing: false,
        id: nanoid(16),
        activity,
        action,
        type,
        author: activity.author,
    }
}

/**
 * @see https://github.com/typeorm/typeorm/issues/873#issuecomment-502294597
 */
export const isNullOrUndefined = <T>(obj: T | null | undefined):obj is null | undefined => {
    return typeof obj === "undefined" || obj === null
}

export const castToBool = (val: any, allowNumbers = true): boolean | undefined => {
    if (val === null || val === undefined) {
        return undefined;
    }
    if (typeof val === 'boolean') {
        return val;
    }
    if (typeof val === 'number' && allowNumbers) {
        if (val === 1) {
            return true;
        }
        if (val === 0) {
            return false;
        }
        return undefined;
    } else if (typeof val === 'string') {
        if (val.trim() === '') {
            return undefined;
        }
        if(val.trim().toLocaleLowerCase() === 'true') {
            return true;
        }
        if(val.trim().toLocaleLowerCase() === 'false') {
            return false;
        }
        if(allowNumbers) {
            if(Number.parseInt(val.trim()) === 1) {
                return true;
            }
            if(Number.parseInt(val.trim()) === 0) {
                return false;
            }
        }
        return undefined;
    }
    return undefined;
}

export const resolvePath = (pathVal: string, relativeRoot: string) => {
    const pathInfo = pathUtil.parse(pathVal);
    // if path looks absolute then just resolve any relative parts and return as-is
    if(pathInfo.root !== '') {
        return pathUtil.resolve(pathVal);
    }
    // if there is no root then resolve it with relative root
    if(pathInfo.dir === '') {
        return pathUtil.resolve(relativeRoot, './', pathVal);
    }
    return pathUtil.resolve(relativeRoot, pathVal);
}

export const resolvePathFromEnvWithRelative = (pathVal: any, relativeRoot: string, defaultVal?: string) => {
    if (pathVal === undefined || pathVal === null) {
        return defaultVal;
    } else if (typeof pathVal === 'string') {
        if (pathVal.trim() === '') {
            return defaultVal;
        }
        return resolvePath(pathVal.trim(), relativeRoot);
    }
    return defaultVal;
}
