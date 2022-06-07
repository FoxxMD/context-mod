import {StringOperator} from "./Atomic";
import {Duration} from "dayjs/plugin/duration";
import InvalidRegexError from "../../Utils/InvalidRegexError";

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
        displayText: `${groups.opStr} ${groups.value}${groups.percent === undefined || groups.percent === '' ? '' : '%'}`
    }
}
