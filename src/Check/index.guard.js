"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCheckConfig = void 0;
/*
 * Generated type guards for "index.ts".
 * WARNING: Do not manually change this file.
 */
const index_guard_1 = require("../Rule/index.guard");
function isCheckConfig(obj, _argumentName) {
    return ((obj !== null &&
        typeof obj === "object" ||
        typeof obj === "function") &&
        typeof obj.name === "string" &&
        (typeof obj.description === "undefined" ||
            typeof obj.description === "string") &&
        (typeof obj.ruleJoin === "undefined" ||
            obj.ruleJoin === "OR" ||
            obj.ruleJoin === "AND") &&
        Array.isArray(obj.rules) &&
        obj.rules.every((e) => (index_guard_1.isRuleConfig(e) ||
            (e !== null &&
                typeof e === "object" ||
                typeof e === "function") &&
                (e.condition === "OR" ||
                    e.condition === "AND") &&
                Array.isArray(e.rules) &&
                e.rules.every((e) => (e !== null &&
                    typeof e === "object" ||
                    typeof e === "function") &&
                    (e.authors !== null &&
                        typeof e.authors === "object" ||
                        typeof e.authors === "function") &&
                    (typeof e.authors.exclude === "undefined" ||
                        Array.isArray(e.authors.exclude) &&
                            e.authors.exclude.every((e) => (e !== null &&
                                typeof e === "object" ||
                                typeof e === "function") &&
                                (typeof e.name === "undefined" ||
                                    Array.isArray(e.name) &&
                                        e.name.every((e) => typeof e === "string")) &&
                                (typeof e.flairCssClass === "undefined" ||
                                    Array.isArray(e.flairCssClass) &&
                                        e.flairCssClass.every((e) => typeof e === "string")) &&
                                (typeof e.flairText === "undefined" ||
                                    Array.isArray(e.flairText) &&
                                        e.flairText.every((e) => typeof e === "string")) &&
                                (typeof e.isMod === "undefined" ||
                                    e.isMod === false ||
                                    e.isMod === true))) &&
                    (typeof e.authors.include === "undefined" ||
                        Array.isArray(e.authors.include) &&
                            e.authors.include.every((e) => (e !== null &&
                                typeof e === "object" ||
                                typeof e === "function") &&
                                (typeof e.name === "undefined" ||
                                    Array.isArray(e.name) &&
                                        e.name.every((e) => typeof e === "string")) &&
                                (typeof e.flairCssClass === "undefined" ||
                                    Array.isArray(e.flairCssClass) &&
                                        e.flairCssClass.every((e) => typeof e === "string")) &&
                                (typeof e.flairText === "undefined" ||
                                    Array.isArray(e.flairText) &&
                                        e.flairText.every((e) => typeof e === "string")) &&
                                (typeof e.isMod === "undefined" ||
                                    e.isMod === false ||
                                    e.isMod === true)))) &&
                Array.isArray(e.rules) &&
                e.rules.every((e) => index_guard_1.isRuleConfig(e)))) &&
        Array.isArray(obj.actions) &&
        obj.actions.every((e) => (e !== null &&
            typeof e === "object" ||
            typeof e === "function") &&
            (e.kind === "comment" ||
                e.kind === "lock" ||
                e.kind === "remove" ||
                e.kind === "report" ||
                e.kind === "flair")));
}
exports.isCheckConfig = isCheckConfig;
//# sourceMappingURL=index.guard.js.map