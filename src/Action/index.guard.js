"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isActionConfig = void 0;
function isActionConfig(obj, _argumentName) {
    return ((obj !== null &&
        typeof obj === "object" ||
        typeof obj === "function") &&
        (obj.kind === "comment" ||
            obj.kind === "lock" ||
            obj.kind === "remove" ||
            obj.kind === "report" ||
            obj.kind === "flair"));
}
exports.isActionConfig = isActionConfig;
//# sourceMappingURL=index.guard.js.map