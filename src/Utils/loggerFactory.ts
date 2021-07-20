import {labelledFormat, logLevels} from "../util";
import winston, {Logger} from "winston";

const {transports} = winston;

export const getDefaultLogger = (options: any): Logger => {
    if(!winston.loggers.has('default')) {
        const {
            logDir = process.env.LOG_DIR || `${process.cwd()}/logs`,
            logLevel = process.env.LOG_LEVEL || 'verbose',
            additionalTransports = [],
        } = options;

        const consoleTransport = new transports.Console();

        const myTransports = [
            consoleTransport,
        ];

        let errorTransports = [consoleTransport];

        for (const a of additionalTransports) {
            myTransports.push(a);
            errorTransports.push(a);
        }

        if (logDir !== false) {
            let logPath = logDir;
            if (logPath === true) {
                logPath = `${process.cwd()}/logs`;
            }
            const rotateTransport = new winston.transports.DailyRotateFile({
                dirname: logPath,
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
            level: logLevel || 'info',
            format: labelledFormat(),
            transports: myTransports,
            levels: logLevels,
            exceptionHandlers: errorTransports,
            rejectionHandlers: errorTransports,
        };

        winston.loggers.add('default', loggerOptions);
    }

    return winston.loggers.get('default');
}
