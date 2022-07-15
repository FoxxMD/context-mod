import {InfluxDB, WriteApi} from "@influxdata/influxdb-client/dist";

export interface InfluxConfig {
    credentials: InfluxCredentials
    defaultTags?: Record<string, string>
}

export interface InfluxCredentials {
    url: string
    token: string
    org: string
    bucket: string
}
