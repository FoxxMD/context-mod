"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRuleSetConfig = void 0;
function isRuleSetConfig(obj, _argumentName) {
    return ((obj !== null &&
        typeof obj === "object" ||
        typeof obj === "function") &&
        (obj.condition === "OR" ||
            obj.condition === "AND") &&
        Array.isArray(obj.rules) &&
        obj.rules.every((e) => (e !== null &&
            typeof e === "object" ||
            typeof e === "function") &&
            (typeof e.authors === "undefined" ||
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
                                    e.isMod === true))))) &&
        Array.isArray(obj.rules) &&
        obj.rules.every((e) => (e !== null &&
            typeof e === "object" ||
            typeof e === "function") &&
            (typeof e.authors === "undefined" ||
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
            (e.kind === "recentActivity" ||
                e.kind === "repeatSubmission")));
}
exports.isRuleSetConfig = isRuleSetConfig;
//# sourceMappingURL=RuleSet.guard.js.map