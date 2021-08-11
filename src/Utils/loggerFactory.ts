import {labelledFormat, logLevels} from "../util";
import winston, {Logger} from "winston";

const {transports} = winston;

export const getLogger = (options: any, name = 'default'): Logger => {
    if(!winston.loggers.has(name)) {
        const {
            path,
            level,
            additionalTransports = [],
            defaultLabel = 'App',
        } = options || {};

        const consoleTransport = new transports.Console({
            handleExceptions: true,
            // @ts-expect-error
            handleRejections: true,
        });

        const myTransports = [
            consoleTransport,
            ...additionalTransports,
        ];

        if (path !== undefined && path !== '') {
            const rotateTransport = new winston.transports.DailyRotateFile({
                dirname: path,
                createSymlink: true,
                symlinkName: 'contextBot-current.log',
                filename: 'contextBot-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxSize: '5m',
                handleExceptions: true,
                handleRejections: true,
            });
            // @ts-ignore
            myTransports.push(rotateTransport);
        }

        const loggerOptions = {
            level: level || 'info',
            format: labelledFormat(defaultLabel),
            transports: myTransports,
            levels: logLevels,
        };

        winston.loggers.add(name, loggerOptions);
    }

    return winston.loggers.get(name);
}
