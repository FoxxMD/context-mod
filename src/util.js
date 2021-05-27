"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLabelledLogger = exports.labelledFormat = exports.defaultFormat = void 0;
const winston_1 = __importDefault(require("winston"));
const safe_stable_stringify_1 = __importDefault(require("safe-stable-stringify"));
const dayjs_1 = __importDefault(require("dayjs"));
const { format } = winston_1.default;
const { combine, printf, timestamp, label, splat, errors } = format;
const s = splat();
const SPLAT = Symbol.for('splat');
const errorsFormat = errors({ stack: true });
const CWD = process.cwd();
let longestLabel = 3;
// @ts-ignore
exports.defaultFormat = printf(({ level, message, label = 'App', timestamp, [SPLAT]: splatObj, stack, ...rest }) => {
    let stringifyValue = splatObj !== undefined ? safe_stable_stringify_1.default(splatObj) : '';
    if (label.length > longestLabel) {
        longestLabel = label.length;
    }
    let msg = message;
    let stackMsg = '';
    if (stack !== undefined) {
        const stackArr = stack.split('\n');
        msg = stackArr[0];
        const cleanedStack = stackArr
            .slice(1) // don't need actual error message since we are showing it as msg
            .map((x) => x.replace(CWD, 'CWD')) // replace file location up to cwd for user privacy
            .join('\n'); // rejoin with newline to preserve formatting
        stackMsg = `\n${cleanedStack}`;
    }
    return `${timestamp} ${level.padEnd(7)}: [${label.padEnd(longestLabel)}] ${msg}${stringifyValue !== '' ? ` ${stringifyValue}` : ''}${stackMsg}`;
});
const labelledFormat = (labelName = 'App') => {
    const l = label({ label: labelName, message: false });
    return combine(timestamp({
        format: () => dayjs_1.default().local().format(),
    }), l, s, errorsFormat, exports.defaultFormat);
};
exports.labelledFormat = labelledFormat;
const createLabelledLogger = (name = 'default', label = 'App') => {
    if (winston_1.default.loggers.has(name)) {
        return winston_1.default.loggers.get(name);
    }
    const def = winston_1.default.loggers.get('default');
    winston_1.default.loggers.add(name, {
        transports: def.transports,
        level: def.level,
        format: exports.labelledFormat(label)
    });
    return winston_1.default.loggers.get(name);
};
exports.createLabelledLogger = createLabelledLogger;
//# sourceMappingURL=util.js.map