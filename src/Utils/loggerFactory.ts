import {labelledFormat, logLevels} from "../util";
import winston, {Logger} from "winston";

const {transports} = winston;

export const getLogger = (options: any, name = 'default'): Logger => {
    if(!winston.loggers.has(name)) {
        const {
            path,
            level,
            additionalTransports = [],
        } = options || {};

        const consoleTransport = new transports.Console();

        const myTransports = [
            consoleTransport,
        ];

        let errorTransports = [consoleTransport];

        for (const a of additionalTransports) {
            myTransports.push(a);
            errorTransports.push(a);
        }

        if (path !== undefined && path !== '') {
            const rotateTransport = new winston.transports.DailyRotateFile({
                dirname: path,
                createSymlink: true,
                symlinkName: 'contextBot-current.log',
                filename: 'contextBot-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxSize: '5m'
            });
            // @ts-ignore
            myTransports.push(rotateTransport);
            // @ts-ignore
            errorTransports.push(rotateTransport);
        }

        const loggerOptions = {
            level: level || 'info',
            format: labelledFormat(),
            transports: myTransports,
            levels: logLevels,
            exceptionHandlers: errorTransports,
            rejectionHandlers: errorTransports,
        };

        winston.loggers.add(name, loggerOptions);
    }

    return winston.loggers.get(name);
}
