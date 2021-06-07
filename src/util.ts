import winston, {Logger} from "winston";
import jsonStringify from 'safe-stable-stringify';
import dayjs from 'dayjs';
import {RulePremise, RuleResult} from "./Rule";
import deepEqual from "fast-deep-equal";
import utc from 'dayjs/plugin/utc.js';
import dduration from 'dayjs/plugin/duration.js';

dayjs.extend(utc);
dayjs.extend(dduration);

const {format} = winston;
const {combine, printf, timestamp, label, splat, errors} = format;

const s = splat();
const SPLAT = Symbol.for('splat')
const errorsFormat = errors({stack: true});
const CWD = process.cwd();

export const truncateStringToLength = (length: number, truncStr = '...') => (str: string) => str.length > length ? `${str.slice(0, length - truncStr.length - 1)}${truncStr}` : str;

export const loggerMetaShuffle = (logger: Logger, newLeaf: (string | undefined | null) = null, extraLabels: string[] = [], {truncateLength = 50} = {}) => {
    const labelTrunc = truncateStringToLength(truncateLength);
    const {labels = [], leaf} = logger.defaultMeta || {};
    return {
        labels: labels.concat(extraLabels.map(x => labelTrunc(x))),
        leaf: newLeaf
    };
}

let longestLabel = 3;
// @ts-ignore
export const defaultFormat = printf(({level, message, label = 'App', labels = [], leaf, itemId, timestamp, [SPLAT]: splatObj, stack, ...rest}) => {
    let stringifyValue = splatObj !== undefined ? jsonStringify(splatObj) : '';
    if (label.length > longestLabel) {
        longestLabel = label.length;
    }
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

    let labelContent = `[${label.padEnd(longestLabel)}]`;
    if(labels.length > 0 || (leaf !== null && leaf !== undefined)) {
        let nodes = labels;
        if(leaf !== null) {
            nodes.push(leaf);
        }
        //labelContent = `${labels.slice(0, labels.length).map((x: string) => `[${x}]`).join(' ')}`
        labelContent = `${nodes.map((x: string) => `[${x}]`).join(' ')}`;
    }
    //let leafContent = leaf !== undefined ? ` (${leaf})` : '';

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
        errorsFormat,
        defaultFormat,
    );
}

export const createLabelledLogger = (name = 'default', label = 'App') => {
    if (winston.loggers.has(name)) {
        return winston.loggers.get(name);
    }
    const def = winston.loggers.get('default');
    winston.loggers.add(name, {
        transports: def.transports,
        level: def.level,
        format: labelledFormat(label)
    });
    return winston.loggers.get(name);
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
            return matches[0][matches[0].length - 1];
        }
    }
    return val;
}

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

export const mergeArr = (objValue: [], srcValue: []): (any[]|undefined) => {
    if (Array.isArray(objValue)) {
        return objValue.concat(srcValue);
    }
}
