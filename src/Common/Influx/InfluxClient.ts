import {InfluxConfig} from "./interfaces";
import {InfluxDB, Point, WriteApi, setLogger} from "@influxdata/influxdb-client";
import {HealthAPI} from "@influxdata/influxdb-client-apis";
import dayjs, {Dayjs} from "dayjs";
import {Logger} from "winston";
import {mergeArr} from "../../util";
import {CMError} from "../../Utils/Errors";

export interface InfluxClientConfig extends InfluxConfig {
    client?: InfluxDB
    ready?: boolean
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
        if(client !== undefined) {
            this.client = client;
        } else {
           this.client = InfluxClient.createClient(this.config);
           setLogger(this.logger);
        }
        this.write = this.client.getWriteApi(config.credentials.org, config.credentials.bucket, 'ms');
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
        return new InfluxDB({
            url: config.credentials.url,
            token: config.credentials.token,
            writeOptions: {
                defaultTags: config.defaultTags
            }
        });
    }

    childClient(logger: Logger, tags: Record<string, string> = {}) {
        return new InfluxClient({
            ...this.config,
            client: this.client,
            ready: this.ready
        }, logger, {...this.tags, ...tags});
    }
}
