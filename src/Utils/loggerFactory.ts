import {castToBool, fileOrDirectoryIsWriteable, labelledFormat, logLevels, mergeArr, resolvePath} from "../util";
import winston, {Logger} from "winston";
import {DuplexTransport} from "winston-duplex";
import {WinstonAdaptor} from 'typeorm-logger-adaptor/logger/winston';
import {LoggerOptions} from 'typeorm';
import {LoggerFactoryOptions} from "../Common/interfaces";
import process from "process";
import path from "path";
import {defaultDataDir} from "../Common/defaults";
import {ErrorWithCause} from "pony-cause";

const {transports} = winston;

export const getLogger = (options: LoggerFactoryOptions, name = 'app'): Logger => {

    const errors: (Error | string)[] = [];

    if (!winston.loggers.has(name)) {
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
                    transform(chunk, e, cb) {
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

            const dirBool = castToBool(dirname, false);
            if (dirBool !== undefined) {
                if (!dirBool) {
                    realDir = undefined;
                } else {
                    realDir = path.resolve(process.env.DATA_DIR ?? defaultDataDir, './logs');
                }
            } else {
                realDir = resolvePath(dirname as string, process.env.DATA_DIR ?? defaultDataDir);
            }

            if (realDir !== undefined) {

                // TODO would like to do a check to make dir is writeable but will have to make this whole function async
                // and getLogger is used in a lot of constructor functions so can't do this for now

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
        }

        const loggerOptions = {
            level: level || 'info',
            format: labelledFormat(defaultLabel),
            transports: myTransports,
            levels: logLevels,
        };

        winston.loggers.add(name, loggerOptions);
    }

    const logger = winston.loggers.get(name);
    if (errors.length > 0) {
        for (const e of errors) {
            logger.error(e);
        }
    }
    return logger;
}
