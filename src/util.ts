import winston, {Logger} from "winston";
import dayjs, {Dayjs} from 'dayjs';
import {Duration} from 'dayjs/plugin/duration.js';
import * as cronjs from '@datasert/cronjs-matcher';
import Ajv from "ajv";
import {InvalidOptionArgumentError} from "commander";
import {deflateSync, inflateSync} from "zlib";
import pixelmatch from 'pixelmatch';
import os from 'os';
import pathUtil from 'path';
import fetch, {Response} from 'node-fetch';
import crypto, {createHash} from 'crypto';
import {
    ActionResult,
    ActivityDispatch,
    ActivityDispatchConfig,
    CheckSummary,
    ImageComparisonResult,
    ItemCritPropHelper,
    LogInfo,
    NamedGroup,
    PollingOptionsStrong,
    PostBehaviorOptionConfig,
    RegExResult,
    RepostItem,
    RepostItemResult,
    RequiredItemCrit,
    ResourceStats,
    RuleResult,
    RuleSetResult,
    RunResult,
    SearchAndReplaceRegExp, SharingACLConfig,
    StringComparisonOptions, StrongSharingACLConfig, StrongTTLConfig, TTLConfig
} from "./Common/interfaces";
import InvalidRegexError from "./Utils/InvalidRegexError";
import {accessSync, constants, promises} from "fs";
import {cacheTTLDefaults, VERSION} from "./Common/defaults";
import cacheManager from "cache-manager";
import Autolinker from 'autolinker';
import {LEVEL, MESSAGE} from "triple-beam";
import {Comment, PrivateMessage, RedditUser, Submission, Subreddit} from "snoowrap/dist/objects";
import reRegExp from '@stdlib/regexp-regexp';
import ImageData from "./Common/ImageData";
import {Sharp, SharpOptions} from "sharp";
import {ErrorWithCause, stackWithCauses} from "pony-cause";
import stringSimilarity from 'string-similarity';
import calculateCosineSimilarity from "./Utils/StringMatching/CosineSimilarity";
import levenSimilarity from "./Utils/StringMatching/levenSimilarity";
import {isRateLimitError, isRequestError, isScopeError, isStatusError, SimpleError} from "./Utils/Errors";
import merge from "deepmerge";
import {RulePremise} from "./Common/Entities/RulePremise";
import {RuleResultEntity as RuleResultEntity} from "./Common/Entities/RuleResultEntity";
import {nanoid} from "nanoid";
import {
    ActivityState,
    asModLogCriteria,
    asModNoteCriteria,
    AuthorCriteria,
    authorCriteriaProperties,
    CommentState,
    defaultStrongSubredditCriteriaOptions,
    ModLogCriteria,
    ModNoteCriteria,
    StrongSubredditCriteria,
    SubmissionState,
    SubredditCriteria,
    TypedActivityState,
    UserNoteCriteria
} from "./Common/Infrastructure/Filters/FilterCriteria";
import {
    ActivitySourceData,
    ActivitySourceTypes,
    ActivitySourceValue,
    ConfigFormat,
    DurationVal,
    ExternalUrlContext,
    ImageHashCacheData,
    ModUserNoteLabel,
    modUserNoteLabels,
    RedditEntity,
    RedditEntityType,
    RelativeDateTimeMatch,
    statFrequencies,
    StatisticFrequency,
    StatisticFrequencyOption,
    UrlContext,
    WikiContext
} from "./Common/Infrastructure/Atomic";
import {
    AuthorOptions,
    FilterCriteriaDefaults,
    FilterCriteriaPropertyResult,
    FilterCriteriaResult,
    FilterOptions,
    FilterOptionsJson,
    FilterResult,
    ItemOptions,
    MaybeAnonymousCriteria,
    MaybeAnonymousOrStringCriteria,
    MinimalOrFullFilter,
    MinimalOrFullMaybeAnonymousFilter,
    NamedCriteria
} from "./Common/Infrastructure/Filters/FilterShapes";
import {
    ActivityType,
    AuthorHistoryType,
    FullNameTypes,
    PermalinkRedditThings,
    RedditThing,
    SnoowrapActivity
} from "./Common/Infrastructure/Reddit";
import {
    ActivityWindowConfig,
    ActivityWindowCriteria,
    FullActivityWindowConfig,
    HistoryFiltersConfig,
    HistoryFiltersOptions
} from "./Common/Infrastructure/ActivityWindow";
import {RunnableBaseJson} from "./Common/Infrastructure/Runnable";
import Snoowrap from "snoowrap";
import {adjectives, animals, colors, uniqueNamesGenerator} from 'unique-names-generator';
import {ActionResultEntity} from "./Common/Entities/ActionResultEntity";


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

const isProbablyError = (val: any, explicitErrorName?: string) => {
    if(typeof val !== 'object' || val === null) {
        return false;
    }
    const {name, stack} = val;
    if(explicitErrorName !== undefined) {
        if(name !== undefined && name.toLowerCase().includes(explicitErrorName)) {
            return true;
        }
        if(stack !== undefined && stack.trim().toLowerCase().indexOf(explicitErrorName.toLowerCase()) === 0) {
            return true;
        }
        return false;
    } else if(stack !== undefined) {
        return true;
    } else if(name !== undefined && name.toLowerCase().includes('error')) {
        return true;
    }

    return false;
}

export const PASS = '✓';
export const FAIL = '✘';

export const truncateStringToLength = (length: number, truncStr = '...') => (str: string) => {
    if(str.length > length) {
        return `${str.slice(0, length - truncStr.length - 1)}${truncStr}`;
    }
    return str;
};

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
    let stringifyValue = splatObj !== undefined ? JSON.stringify(splatObj) : '';
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
    if (leaf !== null && leaf !== undefined && !nodes.includes(leaf)) {
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
        const relevantExisting = combined.filter(x => x.premise.kind.name === result.premise.kind.name).find(x => x.premise.configHash === result.premise.configHash);
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
        return `${triggeredIndicator(res.triggered ?? null)} ${RulePremise.getFriendlyIdentifier(res.premise)}`;
    });
    return parts.join(` ${topLevelCondition} `)
    //return results.map(x => x.name || x.premise.kind).join(' | ')
}

export interface FilterCriteriaSummary {
    name?: string
    summary: string
    details: string[]
}
export const buildFilterCriteriaSummary = <T>(val: FilterCriteriaResult<T>): FilterCriteriaSummary => {
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
    const summary = propSummaryStrArr.join(' | ');
    const details = val.propertyResults.map(x => filterCriteriaPropertySummary(x, val.criteria.criteria));

    return {
        name: val.criteria.name,
        summary,
        details
    }
}

export const filterCriteriaSummary = <T>(val: FilterCriteriaResult<T>): [string, string[]] => {
    const deets = buildFilterCriteriaSummary(val);
    return [deets.summary, deets.details];
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
    let found = '';
    if(val.passed === null || val.passed === undefined) {
        found = '';
    } else if(val.property === 'submissionState') {
        const foundResult = val.found as FilterResult<SubmissionState> | undefined;
        if(foundResult !== undefined) {
            const criteriaResults = foundResult.criteriaResults.map((x, index) => `Criteria #${index + 1} => ${triggeredIndicator(x.passed)}\n   ${x.propertyResults.map(y => filterCriteriaPropertySummary(y, x.criteria.criteria)).join('\n    ')}`).join('\n  ');
            found = `\n  ${criteriaResults}`;
        }
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
            }  else if(asModNoteCriteria(x) || asModLogCriteria(x)) {
                return modActionCriteriaSummary(x);
            }
            return x;
        }).join(' OR ');
        expected = ` => Expected: ${expectedStrings}`;
    }

    return `${val.property as string} => ${passResult}${expected}${found}${val.reason !== undefined ? ` -- ${val.reason}` : ''}${val.behavior === 'exclude' ? ' (Exclude passes when Expected is not Found)' : ''}`;
}

export const createAjvFactory = (logger: Logger): Ajv => {
    const validator =  new Ajv({logger: logger, verbose: true, strict: "log", allowUnionTypes: true});
    // https://ajv.js.org/strict-mode.html#unknown-keywords
    validator.addKeyword('deprecationMessage');
    return validator;
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
    if(!Number.isFinite(val)) {
        return 'Infinite';
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
    return Buffer.from(binaryData).toString('base64');
}

export const isActivityWindowConfig = (val: any): val is FullActivityWindowConfig => {
    if (val !== null && typeof val === 'object') {
        return (val.count !== undefined && typeof val.count === 'number') ||
            // close enough
            val.duration !== undefined;
    }
    return false;
}

// string must only contain ISO8601 optionally wrapped by whitespace
const ISO8601_REGEX: RegExp = /^\s*((-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?)\s*$/;
// finds ISO8601 in any part of a string
const ISO8601_SUBSTRING_REGEX: RegExp = /((-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?)/g;
// string must only duration optionally wrapped by whitespace
const DURATION_REGEX: RegExp = /^\s*(?<time>\d+)\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)\s*$/;
// finds duration in any part of the string
const DURATION_SUBSTRING_REGEX: RegExp = /(?<time>\d+)\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)/g;

export const parseDurationFromString = (val: string, strict = true): {duration: Duration, original: string}[] => {
    let matches = parseRegex(strict ? DURATION_REGEX : DURATION_SUBSTRING_REGEX, val);
    if (matches !== undefined) {
        return matches.map(x => {
            const groups = x.named as NamedGroup;
            const dur: Duration = dayjs.duration(groups.time, groups.unit);
            if (!dayjs.isDuration(dur)) {
                throw new SimpleError(`Parsed value '${x.match}' did not result in a valid Dayjs Duration`);
            }
            return {duration: dur, original: `${groups.time} ${groups.unit}`};
        });
    }

    matches = parseRegex(strict ? ISO8601_REGEX : ISO8601_SUBSTRING_REGEX, val);
    if (matches !== undefined) {
        return matches.map(x => {
            const dur: Duration = dayjs.duration(x.groups[0]);
            if (!dayjs.isDuration(dur)) {
                throw new SimpleError(`Parsed value '${x.groups[0]}' did not result in a valid Dayjs Duration`);
            }
            return {duration: dur, original: x.groups[0]};
        });
    }

    throw new InvalidRegexError([(strict ? DURATION_REGEX : DURATION_SUBSTRING_REGEX), (strict ? ISO8601_REGEX : ISO8601_SUBSTRING_REGEX)], val)
}

export const parseDuration = (val: string, strict = true): Duration => {
    const res = parseDurationFromString(val, strict);
    if(res.length > 1) {
        throw new SimpleError(`Must only have one Duration value, found ${res.length} in: ${val}`);
    }
    return res[0].duration;
}

// https://stackoverflow.com/a/63729682
const RELATIVE_DATETIME_REGEX: RegExp = /(?<cron>(?:(?:(?:(?:\d+,)+\d+|(?:\d+(?:\/|-|#)\d+)|\d+L?|\*(?:\/\d+)?|L(?:-\d+)?|\?|[A-Z]{3}(?:-[A-Z]{3})?) ?){5,7})$)|(?<dayofweek>mon|tues|wed|thurs|fri|sat|sun){1}/i;
const RELATIVE_DATETIME_REGEX_URL = 'https://regexr.com/6u3cc';

// https://day.js.org/docs/en/get-set/day
const dayOfWeekMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tues: 2,
    wed: 3,
    thurs: 4,
    fri: 5,
    sat: 6,
};

export const matchesRelativeDateTime = (expr: RelativeDateTimeMatch, dt: Dayjs) => {
    const res = parseRegexSingleOrFail(RELATIVE_DATETIME_REGEX, expr);
    if (res === undefined) {
        throw new InvalidRegexError(RELATIVE_DATETIME_REGEX, expr, RELATIVE_DATETIME_REGEX_URL);
    }
    if (res.named.dayofweek !== undefined) {
        return dayOfWeekMap[res.named.dayofweek] === dt.day();
    }
    // assume 5-point cron expression
    // the matcher requires datetime second field to be 0 https://github.com/datasert/cronjs/issues/31
    return cronjs.isTimeMatches(res.named.cron, dt.set('second', 0).toISOString());
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

// https://www.reddit.com/r/help/comments/ubeg3s/why_are_there_subreddits_with_name_starting_with/
export const REDDIT_SUBREDDIT_PLACEHOLDER: RegExp = /a:t5_\w+/;
export const REDDIT_SUBREDDIT_PLACEHOLDER_URL = 'https://regexr.com/71tec';
export const REDDIT_ENTITY_REGEX: RegExp = /^\s*(?<entityType>\/[ru]\/|[ru]\/|u_)*(?<name>[\w:-]+)*\s*$/;
export const REDDIT_ENTITY_REGEX_URL = 'https://regexr.com/71tdh';
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
    // if we match a subreddit placeholder pattern for the name then ALWAYS type it as a subreddit
    if(groups.name.match(REDDIT_SUBREDDIT_PLACEHOLDER) !== null) {
        eType = 'subreddit';
    } else if(groups.entityType === undefined || groups.entityType === null) {
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

export const parseWikiContext = (val: string): WikiContext | undefined => {
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

export const parseUrlContext = (val: string): UrlContext | undefined => {
    const wiki = parseWikiContext(val);
    if(wiki !== undefined) {
        return {
            value: val,
            context: wiki
        }
    }
    const urlContext = parseExternalUrl(val);
    if(urlContext !== undefined) {
        return {
            value: val,
            context: {
                url: urlContext
            }
        }
    }
    return undefined;
}

export const asWikiContext = (val: object): val is WikiContext => {
    return val !== null && typeof val === 'object' && 'wiki' in val;
}

export const asExtUrlContext = (val: object): val is ExternalUrlContext => {
    return val !== null && typeof val === 'object' && 'url' in val;
}

export const dummyLogger = {
    debug: (v: any) => null,
    error: (v: any) => null,
    warn: (v: any) => null,
    info: (v: any) => null
}

export const normalizeGistFileKey = (val: string) => val.replaceAll(/[^\w\d]/g, '').toLowerCase().trim();
export const GIST_REGEX = new RegExp(/.*gist\.github\.com\/(?<user>.+)\/(?<gistId>[^#\/]+)(?:#file-(?<fileName>.+))?/i)
export const GIST_RAW_REGEX = new RegExp(/.*gist\.github\.com\/(?<user>.+)\/(?<gistId>[^#\/]+)\/raw\/.+/i)
export const GH_BLOB_REGEX = new RegExp(/.*github\.com\/(?<user>.+)\/(?<repo>.+)\/blob\/(?<path>.+)(?:#.+)?/i);
export const REGEXR_REGEX = new RegExp(/^.*((regexr\.com)\/[\w\d]+).*$/i);
export const REGEXR_PAGE_REGEX = new RegExp(/(.|[\n\r])+"expression":"(.+)","text"/g);
export const fetchExternalResult = async (url: string, logger: (any) = dummyLogger): Promise<[string, Response]> => {
    let hadError = false;
    logger.debug(`Attempting to detect resolvable URL for ${url}`);
    let match = parseRegexSingleOrFail(GIST_RAW_REGEX, url); // check for raw gist url first and if found treat as normal URL
    if(match === undefined) {
        // if not raw then if its still a gist then we need to parse and use API
        match = parseRegexSingleOrFail(GIST_REGEX, url);

        if (match !== undefined) {
            const gistApiUrl = `https://api.github.com/gists/${match.named.gistId}`;
            logger.debug(`Looks like a non-raw gist URL! Trying to resolve ${gistApiUrl} ${match.named.fileName !== undefined ? ` and find file ${match.named.fileName}` : ''}`);

            try {
                const response = await fetch(gistApiUrl);
                if (!response.ok) {
                    logger.warn(`Response was not OK from Gist API (${response.statusText}) -- will return response from original URL instead`);
                    if (response.size > 0) {
                        logger.warn(await response.text())
                    }
                    hadError = true;
                } else {
                    const data = await response.json();
                    // get first found file
                    const fileKeys = Object.keys(data.files);
                    if (fileKeys.length === 0) {
                        logger.error(`No files found in gist!`);
                    } else {
                        let fileKey = fileKeys[0];
                        if (fileKeys.length > 1) {
                            if(match.named.fileName !== undefined) {
                                //const normalizedFileName = normalizeGistFileKey(match.named.fileName.replace('/^file-/', ''));
                                const normalizedFileName = normalizeGistFileKey(match.named.fileName);
                                const matchingKey = fileKeys.find(x => normalizeGistFileKey(x) === normalizedFileName);
                                if(matchingKey === undefined) {
                                    throw new SimpleError(`Found Gist ${match.named.gistId} but it did not contain a file named ${match.named.fileName}`);
                                }
                                fileKey = matchingKey;
                            } else {
                                logger.warn(`More than one file found in gist but URL did not specify a filename! Using first found: ${fileKey}`);
                            }
                        } else {
                            logger.debug(`Using file ${fileKey}`);
                        }
                        const file = data.files[fileKey];
                        if (file.truncated === false) {
                            return [file.content, response];
                        }
                        const rawUrl = file.raw_url;
                        logger.debug(`File contents was truncated, retrieving full contents from ${rawUrl}`);
                        try {
                            const rawUrlResponse = await fetch(rawUrl);
                            return [await rawUrlResponse.text(), rawUrlResponse];
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
    }

    match = parseRegexSingleOrFail(GH_BLOB_REGEX, url)

    if (match !== undefined) {
        const rawUrl = `https://raw.githubusercontent.com/${match.named.user}/${match.named.repo}/${match.named.path}`
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
                return [await response.text(), response];
            }
        } catch (err: any) {
            logger.error('Response returned an error, will return response from original URL instead');
            logger.error(err);
        }
    }

    match = parseRegexSingleOrFail(REGEXR_REGEX, url);
    if(match !== undefined) {
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
    return [await response.text(), response];
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

    if(err instanceof SimpleError && err.stack !== undefined) {
        // reduce stack to just error and originating line
        err.stack = err.stack.split('\n').slice(0, 2).join('\n');
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

export const parseStringToRegexOrLiteralSearch = (val: string, defaultFlags: string = 'i'): RegExp => {
    const maybeRegex = parseStringToRegex(val, defaultFlags);
    if (maybeRegex !== undefined) {
        return maybeRegex;
    }
    const literalSearchRegex = parseStringToRegex(`/${escapeRegex(val.trim())}/`, defaultFlags);
    if (literalSearchRegex === undefined) {
        throw new SimpleError(`Could not convert test value to a valid regex: ${val}`);
    }
    return literalSearchRegex;
}

export const parseRegex = (reg: RegExp, val: string): RegExResult[] | undefined => {

    if(reg.global) {
        const g = Array.from(val.matchAll(reg));
        if(g.length === 0) {
            return undefined;
        }
        return g.map(x => {
            return {
                match: x[0],
                index: x.index,
                groups: x.slice(1),
                named: x.groups || {},
            } as RegExResult;
        });
    }

    const m = val.match(reg)
    if(m === null) {
        return undefined;
    }
    return [{
        match: m[0],
        index: m.index as number,
        groups: m.slice(1),
        named: m.groups || {}
    }];
}

export const parseRegexSingleOrFail = (reg: RegExp, val: string): RegExResult | undefined => {
    const results = parseRegex(reg, val);
    if(results !== undefined) {
        if(results.length > 1) {
                throw new SimpleError(`Expected Regex to match once but got ${results.length} results. Either Regex must NOT be global (using 'g' flag) or parsed value must only match regex once. Given: ${val} || Regex: ${reg.toString()}`);
        }
        return results[0];
    }
    return undefined;
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

export const isStrongSubredditState = (value: SubredditCriteria | StrongSubredditCriteria) => {
    return value.name === undefined || value.name instanceof RegExp;
}

export const asStrongSubredditState = (value: any): value is StrongSubredditCriteria => {
    return isStrongSubredditState(value);
}

export interface StrongSubredditStateOptions {
    defaultFlags?: string
    generateDescription?: boolean
}

export const toStrongSubredditState = (s: SubredditCriteria, opts?: StrongSubredditStateOptions): StrongSubredditCriteria => {
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
    const strongState: StrongSubredditCriteria = {
        ...rest,
        name: nameReg
    };

    // if user provided a regex for "name" then add isUserProfile so we can do a SEPARATE check on the name specifically for user profile prefix
    // -- this way user can regex for a specific name but still filter by prefix
    if(nameValOriginallyRegex && isUserProfile !== undefined) {
        strongState.isUserProfile = isUserProfile;
    }

    if (generateDescription && stateDescription === undefined) {
        strongState.stateDescription = objectToStringSummary(strongState);
    } else {
        strongState.stateDescription = stateDescription;
    }

    return strongState;
}

export const convertSubredditsRawToStrong = (x: (SubredditCriteria | string | StrongSubredditCriteria), opts: StrongSubredditStateOptions): StrongSubredditCriteria => {
    if (typeof x === 'string') {
        return toStrongSubredditState({name: x, stateDescription: x}, opts);
    }
    if(asStrongSubredditState(x)) {
        return x;
    }
    return toStrongSubredditState(x, opts);
}

export async function readConfigFile(path: string, opts?: any): Promise<[string?, ConfigFormat?]> {
    const {log, throwOnNotFound = true} = opts || {};
    let extensionHint: ConfigFormat | undefined;
    const fileInfo = pathUtil.parse(path);
    if (fileInfo.ext !== undefined) {
        switch (fileInfo.ext) {
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
                    log.warn(`No file found at path: ${path}`, {filePath: path});
                }
                e.extension = extensionHint;
                const sError = new SimpleError(`No file found at path: ${path}`);
                sError.code = e.code;
                // @ts-ignore
                sError.extension = extensionHint;
                throw sError;
            } else {
                return [];
            }
        } else if (code === 'EACCES') {
            if (log) {
                log.warn(`Unable to access file path due to permissions: ${path}`, {filePath: path});
            }
            e.extension = extensionHint;
            const sError = new SimpleError(`Unable to access file path due to permissions: ${path}`);
            sError.code = e.code;
            // @ts-ignore
            sError.extension = extensionHint;
            throw sError;
        } else {
            const err = new ErrorWithCause(`Encountered error while parsing file at ${path}`, {cause: e})
            if (log) {
                log.error(e);
            }
            e.extension = extensionHint;
            // @ts-ignore
            err.extension = extensionHint;
            throw err;
        }
    }
}

// export function isObject(item: any): boolean {
//     return (item && typeof item === 'object' && !Array.isArray(item));
// }

export const fileOrDirectoryIsWriteable = (location: string) => {
    const pathInfo = pathUtil.parse(location);
    const isDir = pathInfo.ext === '';
    try {
        accessSync(location, constants.R_OK | constants.W_OK);
        return true;
    } catch (err: any) {
        const {code} = err;
        if (code === 'ENOENT') {
            // file doesn't exist, see if we can write to directory in which case we are good
            try {
                accessSync(pathInfo.dir, constants.R_OK | constants.W_OK)
                // we can write to dir
                return true;
            } catch (accessError: any) {
                if(accessError.code === 'EACCES') {
                    // also can't access directory :(
                    throw new SimpleError(`No ${isDir ? 'directory' : 'file'} exists at ${location} and application does not have permission to write to the parent directory`);
                } else {
                    throw new ErrorWithCause(`No ${isDir ? 'directory' : 'file'} exists at ${location} and application is unable to access the parent directory due to a system error`, {cause: accessError});
                }
            }
        } else if(code === 'EACCES') {
            throw new SimpleError(`${isDir ? 'Directory' : 'File'} exists at ${location} but application does not have permission to write to it.`);
        } else {
            throw new ErrorWithCause(`${isDir ? 'Directory' : 'File'} exists at ${location} but application is unable to access it due to a system error`, {cause: err});
        }
    }
}

export const overwriteMerge = (destinationArray: any[], sourceArray: any[], options: any): any[] => sourceArray;

export const removeUndefinedKeys = <T extends Record<string, any>>(obj: T): T | undefined => {
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

export const toStrongTTLConfig = (data: TTLConfig): StrongTTLConfig => {
    const {
        userNotesTTL = cacheTTLDefaults.userNotesTTL,
        authorTTL = cacheTTLDefaults.authorTTL,
        wikiTTL = cacheTTLDefaults.wikiTTL,
        filterCriteriaTTL = cacheTTLDefaults.filterCriteriaTTL,
        selfTTL = cacheTTLDefaults.selfTTL,
        submissionTTL = cacheTTLDefaults.submissionTTL,
        commentTTL = cacheTTLDefaults.commentTTL,
        subredditTTL = cacheTTLDefaults.subredditTTL,
        modNotesTTL = cacheTTLDefaults.modNotesTTL,
    } = data;

    return {
        authorTTL: authorTTL === true ? 0 : authorTTL,
        submissionTTL: submissionTTL === true ? 0 : submissionTTL,
        commentTTL: commentTTL === true ? 0 : commentTTL,
        subredditTTL: subredditTTL === true ? 0 : subredditTTL,
        wikiTTL: wikiTTL === true ? 0 : wikiTTL,
        filterCriteriaTTL: filterCriteriaTTL === true ? 0 : filterCriteriaTTL,
        modNotesTTL: modNotesTTL === true ? 0 : modNotesTTL,
        selfTTL: selfTTL === true ? 0 : selfTTL,
        userNotesTTL: userNotesTTL === true ? 0 : userNotesTTL,
    };
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


/**
 * Returns elements that both arrays do not have in common
 */
export const symmetricalDifference = (a: Array<any>, b: Array<any>) => {
    return Array.from(setMinus(a, b));
}

/**
 * Returns a Set of elements from valA not in valB
 * */
export function difference(valA: Set<any> | Array<any>, valB: Set<any> | Array<any>) {
    const setA = valA instanceof Set ? valA : new Set(valA);
    const setB = valB instanceof Set ? valB : new Set(valB);
    const _difference = new Set(setA);
    for (const elem of setB) {
        _difference.delete(elem);
    }
    return _difference;
}

// can use 'in' operator to check if object has a property with name WITHOUT TRIGGERING a snoowrap proxy to fetch
export const isSubreddit = (value: any) => {
    try {
        return value !== null && typeof value === 'object' && (value instanceof Subreddit || ('id' in value && value.id !== undefined && value.id.includes('t5_')) || 'display_name' in value);
    } catch (e) {
        return false;
    }
}

export const asSubreddit = (value: any): value is Subreddit => {
    return isSubreddit(value);
}

/**
 * Cached activities lose type information when deserialized so need to check properties as well to see if the object is the shape of a Submission
 * */
export const isSubmission = (value: any) => {
    try {
        return value !== null && typeof value === 'object' && (value instanceof Submission || ('name' in value && value.name !== undefined && value.name.includes('t3_')));
    } catch (e) {
        return false;
    }
}

export const asSubmission = (value: any): value is Submission => {
    return isSubmission(value);
}

export const isComment = (value: any) => {
    try {
        return value !== null && typeof value === 'object' && (value instanceof Comment || ('name' in value && value.name !== undefined && value.name.includes('t1_')));
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
        return value !== null && typeof value === 'object' && (value instanceof RedditUser || ('name' in value && value.name !== undefined && value.name.includes('t2_')));
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

export const modActionCriteriaSummary = (val: (ModNoteCriteria | ModLogCriteria)): string => {
    const isNote = asModNoteCriteria(val);
    const preamble = `${val.count === undefined ? '>= 1' : val.count} of ${val.search === undefined ? 'current' : val.search} ${isNote ? 'notes' : 'actions'} is`;
    const filters = Object.entries(val).reduce((acc: string[], curr) => {
        if(['count', 'search'].includes(curr[0])) {
            return acc;
        }
        const vals = Array.isArray(curr[1]) ? curr[1] : [curr[1]];
       acc.push(`${curr[0]}: ${vals.join(' ,')}`)
        return acc;
    }, []);
    return `${preamble} ${filters.join(' || ')}`;
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

export const parseResultsToMarkdownSummary = (ruleResults: (RuleResultEntity | ActionResultEntity)[]): string => {
    const results = ruleResults.map((y) => {
        let name = y.premise.name;
        const kind = y.premise.kind.name;
        if(name === undefined) {
            name = kind;
        }
        let runIndicator = null;
        if(y instanceof RuleResultEntity) {
            runIndicator = y.triggered;
        } else {
            runIndicator = y.success;
        }
        const {result, ...restY} = y;

        let t = triggeredIndicator(false);
        if(runIndicator === null) {
            t = 'Skipped';
        } else if(runIndicator === true) {
            t = triggeredIndicator(true);
        }
        return `* ${name} - ${t}${result !== undefined ? ` - ${result}` : ''}`;
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
export const shouldCacheSubredditStateCriteriaResult = (state: SubredditCriteria | StrongSubredditCriteria): boolean => {
    // currently there are no scenarios where we need to cache results
    // since only things computed from state are comparisons for properties already cached on subreddit object
    // and regexes for name which aren't that costly
    // -- so just return false
    return false;
}

export const subredditStateIsNameOnly = (state: SubredditCriteria | StrongSubredditCriteria): boolean => {
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

export const fetchToStrongHistoryType = (fetch?: ActivityType | 'submissions' | 'comments' | 'all' | 'overview') => {
    const cleanFetch = fetch !== undefined ? fetch.trim().toLocaleLowerCase() : undefined;

    let trueFetch: AuthorHistoryType;

    if(cleanFetch === undefined) {
        trueFetch = 'overview';
    } else if(['overview','all'].includes(cleanFetch)) {
        trueFetch = 'overview'
    } else if(['submissions','submission'].includes(cleanFetch)) {
        trueFetch = 'submission';
    } else {
        trueFetch = 'comment';
    }

    return trueFetch;
}

export const windowConfigToWindowCriteria = (window: ActivityWindowConfig): ActivityWindowCriteria => {
    let crit: FullActivityWindowConfig;

    if (isActivityWindowConfig(window)) {
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
        subreddits,
        submissionState,
        commentState,
        activityState,
        filterOn,
        debug,
        fetch,
        ...rest
    } = crit;

    let opts: ActivityWindowCriteria = {
        count,
        duration: duration !== undefined ? parseDurationValToDuration(duration) : undefined,
        satisfyOn,
        fetch: fetch === undefined ? fetch : fetchToStrongHistoryType(fetch),
        debug
    };

    if(filterOn !== undefined) {
        const {pre, post} = filterOn;
        opts.filterOn = {};
        if(pre !== undefined) {
            const {debug: preDebug = debug} = pre;
            opts.filterOn.pre = {
                ...historyFilterConfigToOptions(pre),
                max: typeof pre.max === 'number' ? pre.max : parseDurationValToDuration(pre.max),
                debug: preDebug,
            }
        }
        if(post !== undefined) {
            const {debug: postDebug = debug} = post;
            opts.filterOn.post = {
                ...historyFilterConfigToOptions(post),
                debug: postDebug
            }
        }
    }

    if(opts.filterOn?.post === undefined) {
        const potentialPost = removeUndefinedKeys(historyFilterConfigToOptions({subreddits, submissionState, commentState, activityState}));
        if(potentialPost !== undefined) {
            if(opts.filterOn === undefined) {
                opts.filterOn = {
                    post: {
                        ...potentialPost,
                        debug,
                    }
                }
            } else {
                opts.filterOn.post = {
                    ...potentialPost,
                    debug
                };
            }
        }
    }

    return {...rest, ...opts};
}

export const historyFilterConfigToOptions = (val: HistoryFiltersConfig): HistoryFiltersOptions => {
    const opts: HistoryFiltersOptions = {};
    if(val.subreddits !== undefined) {
        opts.subreddits = buildSubredditFilter(val.subreddits);
    }
    if(val.activityState !== undefined) {
        opts.activityState = buildFilter(val.activityState);
    }
    if(val.commentState !== undefined) {
        opts.commentState = buildFilter(val.commentState);
    }
    if(val.submissionState !== undefined) {
        opts.submissionState = buildFilter(val.submissionState);
    }

    return opts;
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

export const mergeFilters = (objectConfig: RunnableBaseJson, filterDefs: FilterCriteriaDefaults | undefined): [AuthorOptions, ItemOptions] => {
    const {authorIs: aisVal = {}, itemIs: iisVal = {}} = objectConfig || {};
    const authorIs = buildFilter(aisVal as MinimalOrFullFilter<AuthorCriteria>);
    const itemIs = buildFilter(iisVal as MinimalOrFullFilter<TypedActivityState>);

    const {
        authorIsBehavior = 'merge',
        itemIsBehavior = 'merge',
        authorIs: authorIsDefault = {},
        itemIs: itemIsDefault = {}
    } = filterDefs || {};

    let derivedAuthorIs: AuthorOptions = buildFilter(authorIsDefault);
    if (authorIsBehavior === 'merge') {
        derivedAuthorIs = {
            excludeCondition: authorIs.excludeCondition ?? derivedAuthorIs.excludeCondition,
            include: addNonConflictingCriteria(derivedAuthorIs.include, authorIs.include),
            exclude: addNonConflictingCriteria(derivedAuthorIs.exclude, authorIs.exclude),
        }
    } else if (!filterIsEmpty(authorIs)) {
        derivedAuthorIs = authorIs;
    }

    let derivedItemIs: ItemOptions = buildFilter(itemIsDefault);
    if (itemIsBehavior === 'merge') {
        derivedItemIs = {
            excludeCondition: itemIs.excludeCondition ?? derivedItemIs.excludeCondition,
            include: addNonConflictingCriteria(derivedItemIs.include, itemIs.include),
            exclude: addNonConflictingCriteria(derivedItemIs.exclude, itemIs.exclude),
        }
    } else if (!filterIsEmpty(itemIs)) {
        derivedItemIs = itemIs;
    }

    return [derivedAuthorIs, derivedItemIs];
}

export const addNonConflictingCriteria = <T>(defaultCriteria: NamedCriteria<T>[] = [], explicitCriteria: NamedCriteria<T>[] = []): NamedCriteria<T>[] => {
    if(explicitCriteria.length === 0) {
        return defaultCriteria;
    }
    const allExplicitKeys = Array.from(explicitCriteria.reduce((acc, curr) => {
        Object.keys(curr.criteria).forEach(key => acc.add(key));
        return acc;
    }, new Set()));
    const nonConflicting = defaultCriteria.filter(x => {
        return intersect(Object.keys(x.criteria), allExplicitKeys).length === 0;
    });
    if(nonConflicting.length > 0) {
        return explicitCriteria.concat(nonConflicting);
    }
    return explicitCriteria;
}

export const filterIsEmpty = (obj: FilterOptions<any>): boolean => {
    return (obj.include === undefined || obj.include.length === 0) && (obj.exclude === undefined || obj.exclude.length === 0);
}

export const buildFilter = (filterVal: MinimalOrFullMaybeAnonymousFilter<AuthorCriteria | TypedActivityState | ActivityState>): FilterOptions<AuthorCriteria | TypedActivityState | ActivityState> => {
    if(Array.isArray(filterVal)) {
        const named = filterVal.map(x => normalizeCriteria(x));
        return {
            include: named,
            excludeCondition: 'OR',
            exclude: [],
        }
    } else {
        const {
            include = [],
            exclude = [],
            excludeCondition,
        } = filterVal;
        const namedInclude = include.map(x => normalizeCriteria(x));
        const namedExclude = exclude.map(x => normalizeCriteria(x))
        return {
            excludeCondition,
            include: namedInclude,
            exclude: namedExclude,
        }
    }
}

// export const buildSubredditFilter = <T extends SubredditState>(filterVal: MinimalSingleOrFullFilter<T>): FilterOptions<T> => {

export const buildSubredditFilter = (filterVal: FilterOptionsJson<SubredditCriteria>): FilterOptions<StrongSubredditCriteria> => {
    if(Array.isArray(filterVal)) {
        return {
            include: filterVal
                .map(x => normalizeSubredditState(x))
                .map(x => ({
                    ...x,
                    criteria: convertSubredditsRawToStrong(x.criteria, defaultStrongSubredditCriteriaOptions)
                })),
            excludeCondition: 'OR',
            exclude: [],
        }
    } else {
        const {
            include = [],
            exclude = [],
            excludeCondition,
        } = filterVal;
        return {
            excludeCondition,
            include: include.map(x => normalizeSubredditState(x))
                .map(x => ({
                    ...x,
                    criteria: convertSubredditsRawToStrong(x.criteria, defaultStrongSubredditCriteriaOptions)
                })),
            exclude: exclude
                .map(x => normalizeSubredditState(x))
                .map(x => ({
                    ...x,
                    criteria: convertSubredditsRawToStrong(x.criteria, defaultStrongSubredditCriteriaOptions)
                }))
        }
    }
}

export const normalizeSubredditState = <T extends SubredditCriteria>(options: MaybeAnonymousOrStringCriteria<T>): NamedCriteria<T> => {
    let name: string | undefined;
    let criteria: T;

    if (asNamedCriteria(options)) {
        criteria = options.criteria;
        name = options.name;
    } else if(typeof options === 'string') {
        criteria = {name: options} as T;
    } else {
        criteria = options;
    }

    return {
        name,
        criteria
    };
}

export const normalizeCriteria = <T extends AuthorCriteria | TypedActivityState | ActivityState>(options: MaybeAnonymousCriteria<T>): NamedCriteria<T> => {

    let name: string | undefined;
    let criteria: T;

    if (asNamedCriteria(options)) {
        criteria = options.criteria;
        name = options.name;
    } else {
        criteria = options;
    }

    if (asAuthorCriteria(criteria)) {
        if(criteria.flairCssClass !== undefined) {
            criteria.flairCssClass = typeof criteria.flairCssClass === 'string' ? [criteria.flairCssClass] : criteria.flairCssClass;
        }
        if(criteria.flairText !== undefined) {
            criteria.flairText = typeof criteria.flairText === 'string' ? [criteria.flairText] : criteria.flairText;
        }
        if(criteria.description !== undefined) {
            criteria.description = Array.isArray(criteria.description) ? criteria.description : [criteria.description];
        }
        if(criteria.modActions !== undefined) {
            criteria.modActions.map((x, index) => normalizeModActionCriteria(x));
        }
    }

    return {
        name,
        criteria
    };
}

export const normalizeModActionCriteria = (x: (ModNoteCriteria | ModLogCriteria)): (ModNoteCriteria | ModLogCriteria) => {
    const common = {
        ...x,
        type: x.type === undefined ? undefined : (Array.isArray(x.type) ? x.type : [x.type])
    }
    if(asModNoteCriteria(x)) {
        return {
            ...common,
            noteType: x.noteType === undefined ? undefined : (Array.isArray(x.noteType) ? x.noteType : [x.noteType]),
            note: x.note === undefined ? undefined : (Array.isArray(x.note) ? x.note : [x.note]),
        }
    } else if(asModLogCriteria(x)) {
        return {
            ...common,
            action: x.action === undefined ? undefined : (Array.isArray(x.action) ? x.action : [x.action]),
            details: x.details === undefined ? undefined : (Array.isArray(x.details) ? x.details : [x.details]),
            description: x.description === undefined ? undefined : (Array.isArray(x.description) ? x.description : [x.description]),
            activityType: x.activityType === undefined ? undefined : (Array.isArray(x.activityType) ? x.activityType : [x.activityType]),
        }
    }
    return common;
}

export const asNamedCriteria = <T>(val: MaybeAnonymousCriteria<T> | undefined): val is NamedCriteria<T> => {
    if(val === undefined || typeof val === 'string') {
        return false;
    }
    return 'criteria' in val;
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
            criteriaResults: authorIs.criteriaResults.map(x => buildFilterCriteriaSummary(x))
        }
    }
    if (itemIs !== undefined && itemIs !== null) {
        formattedResult.itemIs = {
            ...itemIs,
            passed: triggeredIndicator(itemIs.passed),
            criteriaResults: itemIs.criteriaResults.map(x => buildFilterCriteriaSummary(x))
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

export const generateItemFilterHelpers = (stateCriteria: TypedActivityState, include: boolean): [ItemCritPropHelper, RequiredItemCrit] => {
    const definedStateCriteria = (removeUndefinedKeys(stateCriteria) as RequiredItemCrit);

    if(definedStateCriteria === undefined) {
        return [{}, {} as RequiredItemCrit];
    }

    const propResultsMap = Object.entries(definedStateCriteria).reduce((acc: ItemCritPropHelper, [k, v]) => {
        const key = (k as keyof (SubmissionState & CommentState));
        acc[key] = {
            property: key,
            behavior: include ? 'include' : 'exclude',
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
const USER_REGEX: RegExp = /^user:/i;
const ACTIVITY_SOURCE_REGEX: RegExp = /^(?<type>dispatch|poll|user)(?:$|:(?<identifier>[^\s\r\n]+)$)/i
const ACTIVITY_SOURCE_REGEX_URL = 'https://regexr.com/6uqn6';
export const asActivitySourceValue = (val: string): val is ActivitySourceValue => {
    if(['dispatch','poll','user'].some(x => x === val)) {
        return true;
    }
    return DISPATCH_REGEX.test(val) || POLL_REGEX.test(val) || USER_REGEX.test(val);
}

export const asActivitySource = (val: any): val is ActivitySourceData => {
    return null !== val && typeof val === 'object' && 'type' in val;
}

export const strToActivitySourceData = (val: string): ActivitySourceData => {
    const cleanStr = val.trim();
    if (asActivitySourceValue(cleanStr)) {
        const res = parseRegexSingleOrFail(ACTIVITY_SOURCE_REGEX, cleanStr);
        if (res === undefined) {
            throw new InvalidRegexError(ACTIVITY_SOURCE_REGEX, cleanStr, ACTIVITY_SOURCE_REGEX_URL, 'Could not parse activity source');
        }
        return {
            type: res.named.type,
            identifier: res.named.identifier
        }
    }
    throw new SimpleError(`'${cleanStr}' is not a valid ActivitySource. Must be one of: dispatch, dispatch:[identifier], poll, poll:[identifier], user, or user:[identifier]`);
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

export const generateSnoowrapEntityFromRedditThing = (data: RedditThing, client: Snoowrap) => {
    switch(data.type) {
        case 'comment':
            return new Comment({name: data.val, id: data.id}, client, false);
        case 'submission':
            return new Submission({name: data.val, id: data.id}, client, false);
        case 'user':
            return new RedditUser({id: data.val}, client, false);
        case 'subreddit':
            return new Subreddit({id: data.val}, client, false);
        case 'message':
            return new PrivateMessage({id: data.val}, client, false)

    }
}

export const activityDispatchConfigToDispatch = (config: ActivityDispatchConfig, activity: (Comment | Submission), type: ActivitySourceTypes, {action, dryRun}: {action?: string, dryRun?: boolean} = {}): ActivityDispatch => {
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
        id: nanoid(16),
        activity,
        action,
        dryRun,
        type,
        author: getActivityAuthorName(activity.author),
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

export const getExtension = (pathVal: string) => {
    const pathInfo = pathUtil.parse(pathVal);
    return pathInfo.ext;
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

export const asAuthorCriteria = (val: any): val is AuthorCriteria => {
    if (typeof val === 'object' && val !== null) {
        const keys = Object.keys(val);
        return intersect(keys, authorCriteriaProperties).length > 0;
    }
    return false;
}

export const criteriaPassWithIncludeBehavior = (passes: boolean, include: boolean) => {
    // if inner statement IS TRUE then criteria FAILED
    // so to get pass result reverse inner statement result
    return !(
        // DOES NOT PASS and INCLUDE => true
        (include && !passes)
        ||  // OR
        // DOES PASS and DO NOT INCLUDE => true
        (!include && passes)
    );
}

export const frequencyEqualOrLargerThanMin = (val: StatisticFrequency, minFrequency: StatisticFrequencyOption): boolean => {
    if(!minFrequency) {
        return true;
    }
    return statFrequencies.indexOf(minFrequency) <= statFrequencies.indexOf(val);
}

export const asPostBehaviorOptionConfig = (val: any): val is PostBehaviorOptionConfig => {
    if (null === val) {
        return false;
    }
    if (typeof val === 'object') {
        return 'recordTo' in val || 'behavior' in val;
    }
    return false;
}

export const filterByTimeRequirement = (satisfiedEndtime: Dayjs, listSlice: SnoowrapActivity[]): [boolean, SnoowrapActivity[]] => {
    const truncatedItems: SnoowrapActivity[] = listSlice.filter((x) => {
        const utc = x.created_utc * 1000;
        const itemDate = dayjs(utc);
        // @ts-ignore
        return satisfiedEndtime.isBefore(itemDate);
    });

    return [truncatedItems.length !== listSlice.length, truncatedItems]
}

export const between = (val: number, a: number, b: number, inclusiveMin: boolean = false, inclusiveMax: boolean = false): boolean => {
    var min = Math.min(a, b),
        max = Math.max(a, b);

    if(!inclusiveMin && !inclusiveMax) {
        return val > min && val < max;
    }
    if(inclusiveMin && inclusiveMax) {
        return val >= min && val <= max;
    }
    if(inclusiveMin) {
        return val >= min && val < max;
    }

    // inclusive max
    return val > min && val <= max;
}

export const toModNoteLabel = (val: string): ModUserNoteLabel => {
    const cleanVal = val.trim().toUpperCase();
    if (asModNoteLabel(cleanVal)) {
        return cleanVal;
    }
    throw new Error(`${val} is not a valid mod note label. Must be one of: ${modUserNoteLabels.join(', ')}`);
}


export const asModNoteLabel = (val: string): val is ModUserNoteLabel => {
    return modUserNoteLabels.includes(val);
}

/**
 * Split an array into two based on a truthy function
 *
 * Returns arrays -> [[...passed],[...failed]]
 *
 * https://stackoverflow.com/a/42299191/1469797
 * */
export function partition<T>(array: T[], callback: (element: T, index: number, array: T[]) => boolean) {
    return array.reduce(function (result: [T[], T[]], element, i) {
            callback(element, i, array)
                ? result[0].push(element)
                : result[1].push(element);

            return result;
        }, [[], []]
    );
}

export const generateRandomName = () => {
    return uniqueNamesGenerator({
        dictionaries: [colors, adjectives, animals],
        style: 'capital',
        separator: ''
    });
}

export const asStrongImageHashCache = (data: ImageHashCacheData): data is Required<ImageHashCacheData> => {
    return data.original !== undefined && data.flipped !== undefined;
}

export const generateFullWikiUrl = (subreddit: Subreddit | string, location: string) => {
    const subName = subreddit instanceof Subreddit ? subreddit.url : `r/${subreddit}/`;
    return `https://reddit.com${subName}wiki/${location}`
}

export const toStrongSharingACLConfig = (data: SharingACLConfig | string[]): StrongSharingACLConfig => {
    if (Array.isArray(data)) {
        return {
            include: data.map(x => parseStringToRegexOrLiteralSearch(x))
        }
    } else if (data.include !== undefined) {
        return {
            include: data.include.map(x => parseStringToRegexOrLiteralSearch(x))
        }
    }
    return {
        exclude: (data.exclude ?? []).map(x => parseStringToRegexOrLiteralSearch(x))
    }
}
