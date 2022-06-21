import {StringOperator} from "./Atomic";
import {Duration} from "dayjs/plugin/duration";
import InvalidRegexError from "../../Utils/InvalidRegexError";
import dayjs, {Dayjs, OpUnitType} from "dayjs";
import {SimpleError} from "../../Utils/Errors";
import { parseDuration } from "../../util";

export interface DurationComparison {
    operator: StringOperator,
    duration: Duration
}

export interface GenericComparison extends HasDisplayText {
    operator: StringOperator,
    value: number,
    isPercent: boolean,
    extra?: string,
    displayText: string,
    duration?: Duration
}

export interface HasDisplayText {
    displayText: string
}

export interface RangedComparison extends HasDisplayText {
    range: [number, number]
    not: boolean
}

export const asGenericComparison = (val: any): val is GenericComparison => {
    return typeof val === 'object' && 'value' in val;
}

export const GENERIC_VALUE_COMPARISON = /^\s*(?<opStr>>|>=|<|<=)\s*(?<value>-?\d?\.?\d+)(?<extra>\s+.*)*$/
export const GENERIC_VALUE_COMPARISON_URL = 'https://regexr.com/60dq4';
export const parseGenericValueComparison = (val: string, options?: {
    requireDuration?: boolean,
    reg?: RegExp
}): GenericComparison => {

    const {
        requireDuration = false,
        reg = GENERIC_VALUE_COMPARISON,
    } = options || {};

    const matches = val.match(reg);

    if (matches === null) {
        throw new InvalidRegexError(reg, val)
    }

    const groups = matches.groups as any;

    let duration: Duration | undefined;

    if(typeof groups.extra === 'string' && groups.extra.trim() !== '') {
        try {
            duration = parseDuration(groups.extra, false);
        } catch (e) {
            // if it returns an invalid regex just means they didn't
            if (requireDuration || !(e instanceof InvalidRegexError)) {
                throw e;
            }
        }
    } else if(requireDuration) {
        throw new SimpleError(`Comparison must contain a duration value but none was found. Given: ${val}`);
    }

    const displayParts = [`${groups.opStr} ${groups.value}`];
    const hasPercent = typeof groups.percent === 'string' && groups.percent.trim() !== '';
    if(hasPercent) {
        displayParts.push('%');
    }

    return {
        operator: groups.opStr as StringOperator,
        value: Number.parseFloat(groups.value),
        isPercent: hasPercent,
        extra: groups.extra,
        displayText: displayParts.join(''),
        duration
    }
}
const GENERIC_VALUE_PERCENT_COMPARISON = /^\s*(?<opStr>>|>=|<|<=)\s*(?<value>\d+)\s*(?<percent>%)?(?<extra>.*)$/
const GENERIC_VALUE_PERCENT_COMPARISON_URL = 'https://regexr.com/60a16';
export const parseGenericValueOrPercentComparison = (val: string, options?: {requireDuration: boolean}): GenericComparison => {
    return parseGenericValueComparison(val, {...(options ?? {}), reg: GENERIC_VALUE_PERCENT_COMPARISON});
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
export const compareDurationValue = (comp: DurationComparison, date: Dayjs) => {
    const dateToCompare = dayjs().subtract(comp.duration.asSeconds(), 'seconds');
    return dateComparisonTextOp(date, comp.operator, dateToCompare);
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