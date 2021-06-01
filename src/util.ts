import winston from "winston";
import jsonStringify from 'safe-stable-stringify';
import dayjs from 'dayjs';

const {format} = winston;
const {combine, printf, timestamp, label, splat, errors} = format;

const s = splat();
const SPLAT = Symbol.for('splat')
const errorsFormat = errors({stack: true});
const CWD = process.cwd();

let longestLabel = 3;
// @ts-ignore
export const defaultFormat = printf(({level, message, label = 'App', timestamp, [SPLAT]: splatObj, stack, ...rest}) => {
    let stringifyValue = splatObj !== undefined ? jsonStringify(splatObj) : '';
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
            .map((x: string) => x.replace(CWD, 'CWD')) // replace file location up to cwd for user privacy
            .join('\n'); // rejoin with newline to preserve formatting
        stackMsg = `\n${cleanedStack}`;
    }

    return `${timestamp} ${level.padEnd(7)}: [${label.padEnd(longestLabel)}] ${msg}${stringifyValue !== '' ? ` ${stringifyValue}` : ''}${stackMsg}`;
});


export const labelledFormat = (labelName = 'App') => {
    const l = label({label: labelName, message: false});
    return combine(
        timestamp(
            {
                format: () => dayjs().local().format(),
            }
        ),
        l,
        s,
        errorsFormat,
        defaultFormat,
    );
}

export const createLabelledLogger = (name = 'default', label = 'App') => {
    if (winston.loggers.has(name)) {
        return winston.loggers.get(name);
    }
    const def = winston.loggers.get('default');
    winston.loggers.add(name, {
        transports: def.transports,
        level: def.level,
        format: labelledFormat(label)
    });
    return winston.loggers.get(name);
}

/**
 * Group array of objects by given keys
 * @param keys keys to be grouped by
 * @param array objects to be grouped
 * @returns an object with objects in `array` grouped by `keys`
 * @see <https://gist.github.com/mikaello/06a76bca33e5d79cdd80c162d7774e9c>
 */
export const groupBy = <T>(keys: (keyof T)[]) => (array: T[]): Record<string, T[]> =>
    array.reduce((objectsByKeyValue, obj) => {
        const value = keys.map((key) => obj[key]).join('-');
        objectsByKeyValue[value] = (objectsByKeyValue[value] || []).concat(obj);
        return objectsByKeyValue;
    }, {} as Record<string, T[]>);
