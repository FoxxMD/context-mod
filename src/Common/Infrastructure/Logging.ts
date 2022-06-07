import {ConsoleTransportOptions} from "winston/lib/winston/transports";
import {DailyRotateFileTransportOptions} from "winston-daily-rotate-file";
import {DuplexTransportOptions} from "winston-duplex/dist/DuplexTransport";

export type LogLevel = "error" | "warn" | "info" | "verbose" | "debug";
export type LogConsoleOptions =
    Pick<ConsoleTransportOptions, 'silent' | 'eol' | 'stderrLevels' | 'consoleWarnLevels'>
    & {
    level?: LogLevel
}
export type LogFileOptions =
    Omit<DailyRotateFileTransportOptions, 'stream' | 'handleRejections' | 'options' | 'handleExceptions' | 'format' | 'log' | 'logv' | 'close' | 'dirname'>
    & {
    level?: LogLevel
    /**
     * The absolute path to a directory where rotating log files should be stored.
     *
     * * If not present or `null` or `false` no log files will be created
     * * If `true` logs will be stored at `[working directory]/logs`
     *
     * * ENV => `LOG_DIR`
     * * ARG => `--logDir [dir]`
     *
     * @examples ["/var/log/contextmod"]
     * */
    dirname?: string | boolean | null
}
export type LogStreamOptions =
    Omit<DuplexTransportOptions, 'name' | 'stream' | 'handleRejections' | 'handleExceptions' | 'format' | 'log' | 'logv' | 'close'>
    & {
    level?: LogLevel
}

export interface LoggingOptions {
    /**
     * The minimum log level to output. The log level set will output logs at its level **and all levels above it:**
     *
     *  * `error`
     *  * `warn`
     *  * `info`
     *  * `verbose`
     *  * `debug`
     *
     *  Note: `verbose` will display *a lot* of information on the status/result of run rules/checks/actions etc. which is very useful for testing configurations. Once your bot is stable changing the level to `info` will reduce log noise.
     *
     *  * ENV => `LOG_LEVEL`
     *  * ARG => `--logLevel <level>`
     *
     *  @default "verbose"
     *  @examples ["verbose"]
     * */
    level?: LogLevel,
    /**
     * **DEPRECATED** - Use `file.dirname` instead
     * The absolute path to a directory where rotating log files should be stored.
     *
     * * If not present or `null` or `false` no log files will be created
     * * If `true` logs will be stored at `[working directory]/logs`
     *
     * * ENV => `LOG_DIR`
     * * ARG => `--logDir [dir]`
     *
     * @examples ["/var/log/contextmod"]
     * @deprecationMessage use `logging.file.dirname` instead
     * @see logging.file.dirname
     * */
    path?: string | boolean | null

    /**
     * Options for Rotating File logging
     * */
    file?: LogFileOptions
    /**
     * Options for logging to api/web
     * */
    stream?: LogStreamOptions
    /**
     * Options for logging to console
     * */
    console?: LogConsoleOptions
}

export type StrongLoggingOptions = Required<Pick<LoggingOptions, 'stream' | 'console' | 'file'>> & {
    level?: LogLevel
};
export type LoggerFactoryOptions = StrongLoggingOptions & {
    additionalTransports?: any[]
    defaultLabel?: string
}
