import {InfluxConfig} from "./interfaces";
import {InfluxDB, Point, WriteApi, setLogger, DEFAULT_WriteOptions, ClientOptions, DEFAULT_RetryDelayStrategyOptions, Logger as InfluxLogger} from "@influxdata/influxdb-client";
import {HealthAPI} from "@influxdata/influxdb-client-apis";
import dayjs, {Dayjs} from "dayjs";
import {Logger} from "winston";
import {mergeArr} from "../../util";
import {CMError} from "../../Utils/Errors";
import {Agent} from 'http';
import {WriteOptions} from "@influxdata/influxdb-client/dist";

export interface InfluxClientConfig extends InfluxConfig {
    client?: InfluxDB
    ready?: boolean
}

/**
 * Suppress non-error write failures
 *
 * These have not yet hit the max retry. On max retry failure Influx logs as ERROR.
 * The non-error failures are super noisy in the log so suppress them UNLESS debug is turned on
 *
 * https://github.com/influxdata/influxdb-client-js/blob/master/packages/core/src/impl/WriteApiImpl.ts#L221
 * */
const extendLogger = (logger: Logger, suppressWriteWarnings = true): InfluxLogger => {
    return {
        ...logger,
        error: (message: string, err?: any) => logger.error(message, err),
        warn: (message: string, err?: any) => {
            if(suppressWriteWarnings && !message.includes('Write to InfluxDB failed (attempt')) {
                logger.warn(message, err);
            } else {
                logger.warn(message, err);
            }
        }
    }
}

export class InfluxClient {
    config: InfluxConfig;
    client: InfluxDB;
    write: WriteApi;
    health: HealthAPI;

    tags: Record<string, string>;

    logger: Logger;

    ready: boolean;
    lastReadyAttempt: Dayjs | undefined;

    constructor(config: InfluxClientConfig, logger: Logger, tags: Record<string, string> = {}) {

        const {client, ready = false, ...rest} = config;

        this.logger = logger.child({
            labels: ['Influx']
        }, mergeArr);

        this.config = rest;
        this.ready = ready;
        if (client !== undefined) {
            this.client = client;
        } else {
            this.client = InfluxClient.createClient(this.config);
            setLogger(extendLogger(this.logger, !(rest.debug ?? false)));
        }

        this.write = this.client.getWriteApi(config.credentials.org, config.credentials.bucket, 'ms', InfluxClient.createWriteOptions(this.config, this.logger));
        this.tags = tags;
        this.write.useDefaultTags(tags);
        this.health = new HealthAPI(this.client);
    }

    async isReady() {
        if (this.ready) {
            return true;
        }
        if (this.lastReadyAttempt === undefined || dayjs().diff(this.lastReadyAttempt, 's') >= 10) {
            if (!(await this.testConnection())) {
                this.logger.warn('Influx endpoint is not ready');
            } else {
                this.ready = true;
            }
        } else {
            this.logger.debug(`Influx endpoint testing throttled. Waiting another ${10 - dayjs().diff(this.lastReadyAttempt, 's')} seconds`);
        }
        return this.ready;
    }

    async testConnection() {
        try {
            const result = await this.health.getHealth();
            if (result.status === 'fail') {
                return false;
            }
            return true;
        } catch (e: any) {
            this.logger.error(new CMError(`Testing health of Influx endpoint failed`, {cause: e, isSerious: false}));
            return false;
        }
    }

    async writePoint(data: Point | Point[]) {
        if (await this.isReady()) {
            if (Array.isArray(data)) {
                this.write.writePoints(data);
            } else {
                this.write.writePoint(data);
            }
        }
    }

    async flush() {
        if (await this.isReady()) {
            try {
                await this.write.flush(true);
            } catch (e: any) {
                this.logger.error(new CMError('Failed to flush data to Influx', {cause: e}));
            }
        }
    }

    static createClient(config: InfluxConfig): InfluxDB {
        const {
            credentials,
            useKeepAliveAgent = true,
        } = config;

        const clientOptions: ClientOptions = {
            url: credentials.url,
            token: credentials.token,
            writeOptions: InfluxClient.createWriteOptions(config),
        }
        if (useKeepAliveAgent) {
            // reusing connection
            // https://github.com/influxdata/influxdb-client-js/issues/393#issuecomment-985272866
            const agent = new Agent({
                keepAlive: true,
                keepAliveMsecs: 20 * 1000, // 20 seconds keep alive
            })
            process.on('exit', () => agent.destroy())
            clientOptions.transportOptions = {agent};
        }
        return new InfluxDB(clientOptions);
    }

    static createWriteOptions(config: InfluxConfig, logger?: Logger): Partial<WriteOptions> {
        const {
            writeOptions: {
                defaultTags: userDefinedDefaultTags = {},
                ...restUserWriteOptions
            } = {
                batchSize: 500,
                maxRetries: 5,
                // 30 seconds
                flushInterval: 30000
            },
            defaultTags: legacyDefaultTags = {},
            debug = false,
        } = config;

        const allUserDefinedTags = {...legacyDefaultTags, ...userDefinedDefaultTags};

        const writeOptions: Partial<WriteOptions> = {
            ...DEFAULT_WriteOptions,
            ...restUserWriteOptions,
            defaultTags: allUserDefinedTags
        }

        if (debug && logger !== undefined) {
            writeOptions.writeSuccess = (lines: Array<string>) => {
                logger.debug(`Flushed ${lines.length} lines to server`);
            };
            writeOptions.writeRetrySkipped = (entry: { lines: Array<string>; expires: number }) => {
                logger.warn(`Skipped flushing ${entry.lines.length} lines due to full buffer`);
            }
        }

        return writeOptions;
    }

    childClient(logger: Logger, tags: Record<string, string> = {}) {
        return new InfluxClient({
            ...this.config,
            client: this.client,
            ready: this.ready
        }, logger, {...this.tags, ...tags});
    }
}
