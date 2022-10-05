import {StringOperator} from "./Atomic";
import {Duration} from "dayjs/plugin/duration";
import InvalidRegexError from "../../Utils/InvalidRegexError";
import dayjs, {Dayjs, OpUnitType} from "dayjs";
import {CMError, SimpleError} from "../../Utils/Errors";
import {escapeRegex, parseDuration, parseDurationFromString, parseStringToRegex} from "../../util";
import {ReportType} from "./Reddit";

export interface DurationComparison {
    operator: StringOperator,
    duration: Duration
}

export interface GenericComparison extends HasDisplayText {
    operator: StringOperator,
    value: number,
    isPercent: boolean,
    extra?: string,
    groups?: Record<string, string>
    displayText: string,
    duration?: Duration
    durationText?: string
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

export const GENERIC_VALUE_COMPARISON = /^\s*(?<opStr>>|>=|<|<=)\s*(?<value>-?(?:\d+)(?:(?:(?:.|,)\d+)+)?)(?<extra>\s+.*)*$/
export const GENERIC_VALUE_COMPARISON_URL = 'https://regexr.com/6vama';
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
    let durationText: string | undefined;

    try {
        const durationResult = parseDurationFromString(val, false);
        if(durationResult.length > 1) {
            throw new SimpleError(`Must only have one Duration value, found ${durationResult.length} in: ${val}`);
        }
        duration = durationResult[0].duration;
        durationText = durationResult[0].original;
    } catch (e) {
        // if it returns an invalid regex just means they didn't
        if (requireDuration || !(e instanceof InvalidRegexError)) {
            throw e;
        }
    }

    const displayParts = [`${groups.opStr} ${groups.value}`];
    const hasPercent = typeof groups.percent === 'string' && groups.percent.trim() !== '';
    if(hasPercent) {
        displayParts.push('%');
    }

    const {
        opStr,
        value,
        percent,
        extra,
        ...rest
    } = matches.groups || {};

    const extraGroups: Record<string,string> = {};
    let hasExtraGroups = false;

    for(const [k,v] of Object.entries(rest)) {
        if(typeof v === 'string' && v.trim() !== '') {
            extraGroups[k] = v;
            hasExtraGroups = true;
        }
    }

    return {
        operator: groups.opStr as StringOperator,
        value: Number.parseFloat(groups.value),
        isPercent: hasPercent,
        extra: groups.extra,
        groups: hasExtraGroups ? extraGroups : undefined,
        displayText: displayParts.join(''),
        duration,
        durationText,
    }
}
const GENERIC_VALUE_PERCENT_COMPARISON = /^\s*(?<opStr>>|>=|<|<=)\s*(?<value>(?:\d+)(?:(?:(?:.|,)\d+)+)?)\s*(?<percent>%)?(?<extra>.*)$/
const GENERIC_VALUE_PERCENT_COMPARISON_URL = 'https://regexr.com/6valr';
export const parseGenericValueOrPercentComparison = (val: string, options?: {requireDuration: boolean}): GenericComparison => {
    return parseGenericValueComparison(val, {...(options ?? {}), reg: GENERIC_VALUE_PERCENT_COMPARISON});
}
/**
 * Named groups: operator, time, unit
 * */
const DURATION_COMPARISON_REGEX: RegExp = /^\s*(?<opStr>>|>=|<|<=)\s*(?<time>\d+)\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)\s*$/;
const DURATION_COMPARISON_REGEX_URL = 'https://regexr.com/609n8';
export const parseDurationComparison = (val: string): DurationComparison => {
    const result = parseGenericValueComparison(val, {requireDuration: true});
    if(result.isPercent) {
        throw new InvalidRegexError(DURATION_COMPARISON_REGEX, val, DURATION_COMPARISON_REGEX_URL, 'Duration comparison value cannot be a percentage');
    }
    if(result.value < 0) {
        throw new InvalidRegexError(DURATION_COMPARISON_REGEX, val, DURATION_COMPARISON_REGEX_URL,'Duration value cannot be negative');
    }
    return {
        operator: result.operator as StringOperator,
        duration: result.duration as Duration
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

export interface ReportComparison extends Omit<GenericComparison, 'groups'> {
    reportType?: ReportType
    reasonRegex?: RegExp
    reasonMatch?: string
}

const REPORT_COMPARISON = /^\s*(?<opStr>>|>=|<|<=)\s*(?<value>\d+)(?<percent>\s*%)?(?:\s+(?<reportType>mods?|users?))?(?:\s+(?<reasonMatch>["'].*["']|\/.*\/))?.*(?<time>\d+)?\s*(?<unit>days?|weeks?|months?|years?|hours?|minutes?|seconds?|milliseconds?)?\s*$/i
const REPORT_REASON_LITERAL = /["'](.*)["']/i
export const parseReportComparison = (str: string): ReportComparison => {
    const generic = parseGenericValueComparison(str, {reg: REPORT_COMPARISON});


    const {
        groups: {
            reportType,
            reasonMatch
        } = {},
        ...rest
    } = generic;

    const result: ReportComparison = {...rest, reasonMatch};

    if(reportType !== undefined) {
        if(reportType.toLocaleLowerCase().includes('mod')) {
            result.reportType = 'mod' as ReportType;
        } else if (reportType.toLocaleLowerCase().includes('user')) {
            result.reportType = 'user' as ReportType;
        }
    }
    if(reasonMatch !== undefined) {
        const literalMatch = reasonMatch.match(REPORT_REASON_LITERAL);
        if(literalMatch !== null) {
            const cleanLiteralMatch = `/.*${escapeRegex(literalMatch[1].trim())}.*/`;
            result.reasonRegex = parseStringToRegex(cleanLiteralMatch, 'i');
            if(result.reasonRegex === undefined) {
                throw new CMError(`Could not convert reason match value to Regex: ${cleanLiteralMatch}`, {isSerious: false})
            }
        } else {
            result.reasonRegex = parseStringToRegex(reasonMatch, 'i');
            if(result.reasonRegex === undefined) {
                throw new CMError(`Could not convert reason match value to Regex: ${reasonMatch}`, {isSerious: false})
            }
        }
    }

    return result;
}
