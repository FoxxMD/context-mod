import {labelledFormat, logLevels, mergeArr} from "../util";
import winston, {Logger} from "winston";
import {DuplexTransport} from "winston-duplex";
import { WinstonAdaptor } from 'typeorm-logger-adaptor/logger/winston';
import {LoggerOptions} from 'typeorm';
import {LoggerFactoryOptions} from "../Common/interfaces";
import process from "process";
import path from "path";

const {transports} = winston;

export const getLogger = (options: LoggerFactoryOptions, name = 'app'): Logger => {
    if(!winston.loggers.has(name)) {
        const {
            level,
            additionalTransports = [],
            defaultLabel = 'App',
            file: {
                dirname = undefined,
                ...fileRest
            } = {},
            console,
            stream
        } = options || {};

        const consoleTransport = new transports.Console({
            ...console,
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
                handleExceptions: true,
                handleRejections: true,
                ...stream,
                dump: false,
            }),
            ...additionalTransports,
        ];

        if (dirname !== undefined && dirname !== '' && dirname !== null) {

            let realDir: string | undefined;
            if(typeof dirname === 'boolean') {
                if(!dirname) {
                    realDir = undefined;
                } else {
                    realDir = path.resolve(__dirname, '../../logs')
                }
            } else if(dirname === 'true') {
                realDir = path.resolve(__dirname, '../../logs')
            } else if(dirname === 'false') {
                realDir = undefined;
            } else {
                realDir = dirname;
            }

            const rotateTransport = new winston.transports.DailyRotateFile({
                createSymlink: true,
                symlinkName: 'contextBot-current.log',
                filename: 'contextBot-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxSize: '5m',
                dirname: realDir,
                ...fileRest,
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

export const getDatabaseLogger = (logger: Logger, typeOptions: LoggerOptions) => {
    const dbLogger = logger.child({labels: ['Database']}, mergeArr);
    return new WinstonAdaptor(dbLogger, typeOptions)
};
