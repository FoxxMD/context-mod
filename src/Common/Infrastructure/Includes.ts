import {ConfigFormat} from "./Atomic";

export interface IncludesData {
    path: IncludesString
    //path: string
    type?: ConfigFormat
    ttl?: number | boolean
}

export type IncludesUrl = `url:${string}`;
export type IncludesWiki = `wiki:${string}`;
export type IncludesString = IncludesUrl | IncludesWiki;

export type IncludesType = IncludesString | IncludesData;
//export type IncludesType = string | IncludesData;

export const asIncludesData = (val: any): val is IncludesData => {
    return val !== null && typeof val === 'object' && 'path' in val;
}
