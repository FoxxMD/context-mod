/*
 * Generated type guards for "index.ts".
 * WARNING: Do not manually change this file.
 */
import { RuleJSONConfig } from "./index";

export function isRuleConfig(obj: any, _argumentName?: string): obj is RuleJSONConfig {
    return (
        (obj !== null &&
            typeof obj === "object" ||
            typeof obj === "function") &&
        (typeof obj.name === "undefined" ||
            typeof obj.name === "string") &&
        (typeof obj.authors === "undefined" ||
            (obj.authors !== null &&
                typeof obj.authors === "object" ||
                typeof obj.authors === "function") &&
            (typeof obj.authors.exclude === "undefined" ||
                Array.isArray(obj.authors.exclude) &&
                obj.authors.exclude.every((e: any) =>
                    (e !== null &&
                        typeof e === "object" ||
                        typeof e === "function") &&
                    (typeof e.name === "undefined" ||
                        Array.isArray(e.name) &&
                        e.name.every((e: any) =>
                            typeof e === "string"
                        )) &&
                    (typeof e.flairCssClass === "undefined" ||
                        Array.isArray(e.flairCssClass) &&
                        e.flairCssClass.every((e: any) =>
                            typeof e === "string"
                        )) &&
                    (typeof e.flairText === "undefined" ||
                        Array.isArray(e.flairText) &&
                        e.flairText.every((e: any) =>
                            typeof e === "string"
                        )) &&
                    (typeof e.isMod === "undefined" ||
                        e.isMod === false ||
                        e.isMod === true)
                )) &&
            (typeof obj.authors.include === "undefined" ||
                Array.isArray(obj.authors.include) &&
                obj.authors.include.every((e: any) =>
                    (e !== null &&
                        typeof e === "object" ||
                        typeof e === "function") &&
                    (typeof e.name === "undefined" ||
                        Array.isArray(e.name) &&
                        e.name.every((e: any) =>
                            typeof e === "string"
                        )) &&
                    (typeof e.flairCssClass === "undefined" ||
                        Array.isArray(e.flairCssClass) &&
                        e.flairCssClass.every((e: any) =>
                            typeof e === "string"
                        )) &&
                    (typeof e.flairText === "undefined" ||
                        Array.isArray(e.flairText) &&
                        e.flairText.every((e: any) =>
                            typeof e === "string"
                        )) &&
                    (typeof e.isMod === "undefined" ||
                        e.isMod === false ||
                        e.isMod === true)
                ))) &&
        (obj.kind === "recentActivity" ||
            obj.kind === "repeatSubmission" ||
            obj.kind === "author")
    )
}
