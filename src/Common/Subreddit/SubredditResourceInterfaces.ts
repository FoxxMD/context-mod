import {ActivityDispatch, CacheConfig, Footer, ThirdPartyCredentialsJsonConfig, TTLConfig} from "../interfaces";
import {Cache} from "cache-manager";
import {Subreddit} from "snoowrap/dist/objects";
import {DataSource} from "typeorm";
import {Logger} from "winston";
import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import {ManagerEntity} from "../Entities/ManagerEntity";
import {Bot} from "../Entities/Bot";
import {EventRetentionPolicyRange, StatisticFrequencyOption} from "../Infrastructure/Atomic";

export interface SubredditResourceOptions extends Footer {
    ttl: Required<TTLConfig>
    cache: Cache
    cacheType: string;
    cacheSettingsHash: string
    subreddit: Subreddit,
    database: DataSource
    logger: Logger;
    client: ExtendedSnoowrap;
    prefix?: string;
    actionedEventsMax: number;
    thirdPartyCredentials: ThirdPartyCredentialsJsonConfig
    delayedItems?: ActivityDispatch[]
    botAccount?: string
    botName: string
    managerEntity: ManagerEntity
    botEntity: Bot
    statFrequency: StatisticFrequencyOption
    retention?: EventRetentionPolicyRange
}

export interface SubredditResourceConfig extends Footer {
    caching?: CacheConfig,
    subreddit: Subreddit,
    logger: Logger;
    client: ExtendedSnoowrap
    credentials?: ThirdPartyCredentialsJsonConfig
    managerEntity: ManagerEntity
    botEntity: Bot
    statFrequency: StatisticFrequencyOption
    retention?: EventRetentionPolicyRange
}
