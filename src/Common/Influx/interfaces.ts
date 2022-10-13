import {InfluxDB, WriteApi, WriteOptions} from "@influxdata/influxdb-client/dist";

export interface InfluxConfig {
    credentials: InfluxCredentials
    defaultTags?: Record<string, string>
    writeOptions?: WriteOptions
    useKeepAliveAgent?: boolean
    debug?: boolean
}

export interface InfluxCredentials {
    url: string
    token: string
    org: string
    bucket: string
}
