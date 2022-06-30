import {ConfigFormat} from "./Atomic";

export interface IncludesData {
    /**
     * The special-form path to the config fragment to retrieve.
     *
     * If value starts with `wiki:` then the proceeding value will be used to get a wiki page from the current subreddit
     *
     *  * EX `wiki:botconfig/mybot` tries to get `https://reddit.com/r/currentSubreddit/wiki/botconfig/mybot`
     *
     * If the value starts with `wiki:` and ends with `|someValue` then `someValue` will be used as the base subreddit for the wiki page
     *
     * * EX `wiki:replytemplates/test|ContextModBot` tries to get `https://reddit.com/r/ContextModBot/wiki/replytemplates/test`
     *
     * If the value starts with `url:` then the value is fetched as an external url and expects raw text returned
     *
     * * EX `url:https://pastebin.com/raw/38qfL7mL` tries to get the text response of `https://pastebin.com/raw/38qfL7mL`
     * */
    path: string
    /**
     * An unused hint about the content type. Not implemented yet
     * */
    type?: ConfigFormat
    /**
     * Control caching for the config fragment.
     *
     * If not specified the value for `wikiTTL` will be used
     *
     * * If true then value is cached forever
     * * If false then value is never cached
     * * If a number then the number of seconds to cache value
     * * If 'response' then CM will attempt to use Cache-Control or Expires headers from the response to determine how long to cache the value
     * */
    ttl?: number | boolean | 'response'
}

export type IncludesUrl = `url:${string}`;
export type IncludesWiki = `wiki:${string}`;
export type IncludesString = IncludesUrl | IncludesWiki;

export type IncludesType = string | IncludesData;

export const asIncludesData = (val: any): val is IncludesData => {
    return val !== null && typeof val === 'object' && 'path' in val;
}
