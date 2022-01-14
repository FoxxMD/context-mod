import {labelledFormat, logLevels, mergeArr} from "../util";
import winston, {Logger} from "winston";
import {DuplexTransport} from "winston-duplex";
import { WinstonAdaptor } from 'typeorm-logger-adaptor/logger/winston';
import {LoggerOptions} from 'typeorm';

const {transports} = winston;

export const getLogger = (options: any, name = 'app'): Logger => {
    if(!winston.loggers.has(name)) {
        const {
            path,
            level,
            additionalTransports = [],
            defaultLabel = 'App',
        } = options || {};

        const consoleTransport = new transports.Console({
            handleExceptions: true,
            handleRejections: true,
        });

        const myTransports = [
            consoleTransport,
            new DuplexTransport({
                stream: {
                    transform(chunk,e, cb) {
                        cb(null, chunk);
                    },
                    objectMode: true,
                },
                name: 'duplex',
                dump: false,
                handleExceptions: true,
                handleRejections: true,
            }),
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

export const getDatabaseLogger = (options: any, name = 'app', typeOptions: LoggerOptions) => {
    const logger = getLogger(options, name);
    const dbLogger = logger.child({leaf: 'Database'}, mergeArr);
    return new WinstonAdaptor(dbLogger, typeOptions)
};
