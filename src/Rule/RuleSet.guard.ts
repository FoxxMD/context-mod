/*
 * Generated type guards for "RuleSet.ts".
 * WARNING: Do not manually change this file.
 */
import { RuleSetJSONConfig } from "./RuleSet";

export function isRuleSetConfig(obj: any, _argumentName?: string): obj is RuleSetJSONConfig {
    return (
        (obj !== null &&
            typeof obj === "object" ||
            typeof obj === "function") &&
        (obj.condition === "OR" ||
            obj.condition === "AND") &&
        Array.isArray(obj.rules) &&
        obj.rules.every((e: any) =>
            (e !== null &&
                typeof e === "object" ||
                typeof e === "function") &&
            (typeof e.name === "undefined" ||
                typeof e.name === "string") &&
            (typeof e.authors === "undefined" ||
                (e.authors !== null &&
                    typeof e.authors === "object" ||
                    typeof e.authors === "function") &&
                (typeof e.authors.exclude === "undefined" ||
                    Array.isArray(e.authors.exclude) &&
                    e.authors.exclude.every((e: any) =>
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
                (typeof e.authors.include === "undefined" ||
                    Array.isArray(e.authors.include) &&
                    e.authors.include.every((e: any) =>
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
                    )))
        ) &&
        Array.isArray(obj.rules) &&
        obj.rules.every((e: any) =>
        ((e !== null &&
            typeof e === "object" ||
            typeof e === "function") &&
            (typeof e.window === "undefined" ||
                typeof e.window === "string" ||
                typeof e.window === "number") &&
            (typeof e.usePostAsReference === "undefined" ||
                e.usePostAsReference === false ||
                e.usePostAsReference === true) &&
            (typeof e.lookAt === "undefined" ||
                e.lookAt === "comments" ||
                e.lookAt === "submissions") &&
            Array.isArray(e.thresholds) &&
            e.thresholds.every((e: any) =>
                (e !== null &&
                    typeof e === "object" ||
                    typeof e === "function") &&
                Array.isArray(e.subreddits) &&
                e.subreddits.every((e: any) =>
                    typeof e === "string"
                ) &&
                (typeof e.count === "undefined" ||
                    typeof e.count === "number")
            ) &&
            (e !== null &&
                typeof e === "object" ||
                typeof e === "function") &&
            (typeof e.name === "undefined" ||
                typeof e.name === "string") &&
            (typeof e.authors === "undefined" ||
                (e.authors !== null &&
                    typeof e.authors === "object" ||
                    typeof e.authors === "function") &&
                (typeof e.authors.exclude === "undefined" ||
                    Array.isArray(e.authors.exclude) &&
                    e.authors.exclude.every((e: any) =>
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
                (typeof e.authors.include === "undefined" ||
                    Array.isArray(e.authors.include) &&
                    e.authors.include.every((e: any) =>
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
            (e.kind === "recentActivity" ||
                e.kind === "repeatSubmission" ||
                e.kind === "author") ||
            (e !== null &&
                typeof e === "object" ||
                typeof e === "function") &&
            typeof e.threshold === "number" &&
            (typeof e.window === "undefined" ||
                typeof e.window === "string" ||
                typeof e.window === "number") &&
            (typeof e.gapAllowance === "undefined" ||
                typeof e.gapAllowance === "number") &&
            (typeof e.usePostAsReference === "undefined" ||
                e.usePostAsReference === false ||
                e.usePostAsReference === true) &&
            (typeof e.include === "undefined" ||
                Array.isArray(e.include) &&
                e.include.every((e: any) =>
                    typeof e === "string"
                )) &&
            (typeof e.exclude === "undefined" ||
                Array.isArray(e.exclude) &&
                e.exclude.every((e: any) =>
                    typeof e === "string"
                )) &&
            (e !== null &&
                typeof e === "object" ||
                typeof e === "function") &&
            (typeof e.name === "undefined" ||
                typeof e.name === "string") &&
            (typeof e.authors === "undefined" ||
                (e.authors !== null &&
                    typeof e.authors === "object" ||
                    typeof e.authors === "function") &&
                (typeof e.authors.exclude === "undefined" ||
                    Array.isArray(e.authors.exclude) &&
                    e.authors.exclude.every((e: any) =>
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
                (typeof e.authors.include === "undefined" ||
                    Array.isArray(e.authors.include) &&
                    e.authors.include.every((e: any) =>
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
            (e.kind === "recentActivity" ||
                e.kind === "repeatSubmission" ||
                e.kind === "author"))
        )
    )
}
