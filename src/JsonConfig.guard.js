"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isJsonConfig = void 0;
/*
 * Generated type guards for "JsonConfig.ts".
 * WARNING: Do not manually change this file.
 */
const index_guard_1 = require("./Check/index.guard");
function isJsonConfig(obj, _argumentName) {
    return ((obj !== null &&
        typeof obj === "object" ||
        typeof obj === "function") &&
        Array.isArray(obj.checks) &&
        obj.checks.every((e) => index_guard_1.isCheckConfig(e)));
}
exports.isJsonConfig = isJsonConfig;
//# sourceMappingURL=JsonConfig.guard.js.map