import {DurationUnitsObjectType} from "dayjs/plugin/duration";

/**
 * An ISO 8601 Duration
 * @pattern ^(-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$
 * */
export type ISO8601 = string;
export type ActivityWindowType = ISO8601 | number | ActivityWindowCriteria;

/**
 * If both properties are defined then the first criteria met will be used IE if # of activities = count before duration is reached then count will be used, or vice versa
 * @minProperties 1
 * @additionalProperties false
 * */
export interface ActivityWindowCriteria {
    /**
     * The number of activities (submission/comments) to consider
     * */
    count?: number,
    /**
     * An ISO 8601 duration or Day.js duration object
     * @examples ["PT1M", {"minutes": 15}]
     * */
    duration?: ISO8601 | DurationObject
}

/**
 * A Day.js duration object
 * @see https://day.js.org/docs/en/durations/creating
 * @minProperties 1
 * @additionalProperties false
 * */
export interface DurationObject {
    seconds?: number
    minutes?: number
    hours?: number
    days?: number
    weeks?: number
    months?: number
    years?: number
}


export const windowExample: ActivityWindowType[] = [
    15,
    'PT1M',
    {
        count: 10
    },
    {
        duration: {
            hours: 5
        }
    },
    {
        count: 5,
        duration: {
            minutes: 15
        }
    }
];


export interface ActivityWindow {
    /**
     * Criteria for defining what set of activities should be considered. See ActivityWindowCriteria for descriptions of what different data types will do
     * //@examples require('./interfaces.ts').windowExample
     */
    window?: ActivityWindowType,
}

// export type AtLeastOne<T> = { [K in keyof T]: Pick<T, K> }[keyof T]
