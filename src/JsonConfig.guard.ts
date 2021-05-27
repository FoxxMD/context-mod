/*
 * Generated type guards for "JsonConfig.ts".
 * WARNING: Do not manually change this file.
 */
import { isCheckConfig } from "./Check/index.guard";
import { JSONConfig } from "./JsonConfig";

export function isJsonConfig(obj: any, _argumentName?: string): obj is JSONConfig {
    return (
        (obj !== null &&
            typeof obj === "object" ||
            typeof obj === "function") &&
        Array.isArray(obj.checks) &&
        obj.checks.every((e: any) =>
            isCheckConfig(e) as boolean
        )
    )
}
