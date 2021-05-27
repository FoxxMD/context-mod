"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRuleConfig = void 0;
function isRuleConfig(obj, _argumentName) {
    return ((obj !== null &&
        typeof obj === "object" ||
        typeof obj === "function") &&
        (obj.authors !== null &&
            typeof obj.authors === "object" ||
            typeof obj.authors === "function") &&
        (typeof obj.authors.exclude === "undefined" ||
            Array.isArray(obj.authors.exclude) &&
                obj.authors.exclude.every((e) => (e !== null &&
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
        (typeof obj.authors.include === "undefined" ||
            Array.isArray(obj.authors.include) &&
                obj.authors.include.every((e) => (e !== null &&
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
        (obj.kind === "recentActivity" ||
            obj.kind === "repeatSubmission"));
}
exports.isRuleConfig = isRuleConfig;
//# sourceMappingURL=index.guard.js.map