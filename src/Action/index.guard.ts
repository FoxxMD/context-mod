/*
 * Generated type guards for "index.ts".
 * WARNING: Do not manually change this file.
 */
import { ActionJSONConfig } from "./index";

export function isActionConfig(obj: any, _argumentName?: string): obj is ActionJSONConfig {
    return (
        (obj !== null &&
            typeof obj === "object" ||
            typeof obj === "function") &&
        (typeof obj.name === "undefined" ||
            typeof obj.name === "string") &&
        (obj.kind === "comment" ||
            obj.kind === "lock" ||
            obj.kind === "remove" ||
            obj.kind === "report" ||
            obj.kind === "flair")
    )
}
