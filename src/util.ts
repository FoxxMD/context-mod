import winston, {Logger} from "winston";
import jsonStringify from 'safe-stable-stringify';
import dayjs, {Dayjs, OpUnitType} from 'dayjs';
import {RulePremise, RuleResult} from "./Rule";
import deepEqual from "fast-deep-equal";
import {Duration} from 'dayjs/plugin/duration.js';
import Ajv from "ajv";
import {InvalidOptionArgumentError} from "commander";
import Submission from "snoowrap/dist/objects/Submission";
import {Comment} from "snoowrap";
import {inflateSync, deflateSync} from "zlib";
import {ActivityWindowCriteria, DurationComparison, StringOperator} from "./Common/interfaces";
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

export const truncateStringToLength = (length: number, truncStr = '...') => (str: string) => str.length > length ? `${str.slice(0, length - truncStr.length - 1)}${truncStr}` : str;

export const defaultFormat = printf(({
                                         level,
                                         message,
                                         labels = ['App'],
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
        msg = stackArr[0];
        const cleanedStack = stackArr
            .slice(1) // don't need actual error message since we are showing it as msg
            .map((x: string) => x.replace(CWD, 'CWD')) // replace file location up to cwd for user privacy
            .join('\n'); // rejoin with newline to preserve formatting
        stackMsg = `\n${cleanedStack}`;
    }

    let nodes = labels;
    if (leaf !== null && leaf !== undefined) {
        nodes.push(leaf);
    }
    const labelContent = `${nodes.map((x: string) => `[${x}]`).join(' ')}`;

    return `${timestamp} ${level.padEnd(7)}: ${labelContent} ${msg}${stringifyValue !== '' ? ` ${stringifyValue}` : ''}${stackMsg}`;
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

export const createAjvFactory = (logger: Logger) => {
    return  new Ajv({logger: logger, verbose: true, strict: "log", allowUnionTypes: true});
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

export const percentFromString = (str: string): number => {
   const n = Number.parseInt(str.replace('%', ''));
   if(Number.isNaN(n)) {
       throw new Error(`${str} could not be parsed to a number`);
   }
   return n / 100;
}

export const formatNumber = ( val: number|string, options: any = {} ) => {
    const {
        toFixed    = 2,
        defaultVal = null,
        prefix     = '',
        suffix     = '',
        round = {
            type: 'round',
            enable: false,
            indicate: true,
        }
    }         = options;
    let parsedVal = typeof val === 'number' ? val : Number.parseFloat( val );
    if(Number.isNaN( parsedVal )) {
        return defaultVal;
    }
    let prefixStr = prefix;
    const { enable = true, indicate = true, type = 'round' } = round;
    if(enable && !Number.isInteger(parsedVal)) {
        switch(type) {
            case 'round':
                parsedVal = Math.round(parsedVal);
                break;
            case 'ceil':
                parsedVal = Math.ceil(parsedVal);
                break;
            case 'floor':
                parsedVal = Math.floor(parsedVal);
        }
        if(indicate) {
            prefixStr = `~${prefix}`;
        }
    }
    const localeString = parsedVal.toLocaleString( undefined, {
        minimumFractionDigits: toFixed,
        maximumFractionDigits: toFixed,
    } );
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

/**
 * Named groups: operator, time, unit
 * */
const DURATION_REGEX: RegExp = /^\s*(?<opStr>>|>=|<|<=)\s*(?<time>\d+)\s*(?<unit>days|weeks|months|years|hours|minutes|seconds|milliseconds)\s*$/;
const DURATION_REGEX_URL = 'https://regexr.com/609n8';
export const parseDurationComparison = (val: string): DurationComparison => {
    const matches = val.match(DURATION_REGEX);
    if (matches === null) {
        throw new InvalidRegexError(DURATION_REGEX, val, DURATION_REGEX_URL)
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
