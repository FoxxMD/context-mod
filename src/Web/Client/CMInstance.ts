import {URL} from "url";
import {Logger} from "winston";
import {BotInstance, CMInstanceInterface, CMInstanceInterface as CMInterface} from "../interfaces";
import dayjs from 'dayjs';
import {BotConnection, LogInfo} from "../../Common/interfaces";
import normalizeUrl from "normalize-url";
import {HeartbeatResponse} from "../Common/interfaces";
import jwt from "jsonwebtoken";
import got from "got";
import {ErrorWithCause} from "pony-cause";

export class CMInstance implements CMInterface {
    friendly?: string;
    operators: string[] = [];
    operatorDisplay: string = '';
    url: URL;
    normalUrl: string;
    lastCheck?: number;
    online: boolean = false;
    subreddits: string[] = [];
    bots: BotInstance[] = [];
    error?: string | undefined;
    ranMigrations: boolean = false;
    migrationBlocker?: string
    host: string;
    secret: string;

    logger: Logger;
    logs: LogInfo[] = [];

    constructor(options: BotConnection, logger: Logger) {
        const {
            host,
            secret
        } = options;

        this.host = host;
        this.secret = secret;

        const normalized = normalizeUrl(options.host);
        this.normalUrl = normalized;
        this.url = new URL(normalized);

        const name = this.getName;

        this.logger = logger.child({
            get instance() {
                return name();
            }
        });

        this.logger.stream().on('log', (log: LogInfo) => {
            if(log.instance !== undefined && log.instance === this.getName()) {
                this.logs = [log, ...this.logs].slice(0, 301);
            }
        });
    }

    getData(): CMInterface {
        return {
            friendly: this.getName(),
            operators: this.operators,
            operatorDisplay: this.operatorDisplay,
            url: this.url,
            normalUrl: this.normalUrl,
            lastCheck: this.lastCheck,
            online: this.online,
            subreddits: this.subreddits,
            bots: this.bots,
            error: this.error,
            host: this.host,
            secret: this.secret,
            ranMigrations: this.ranMigrations,
            migrationBlocker: this.migrationBlocker,
        }
    }

    getName = () => {
        if (this.friendly !== undefined) {
            return this.friendly
        }
        return this.url.host;
    }

    matchesHost = (val: string) => {
        return normalizeUrl(val) == this.normalUrl;
    }

    updateFromHeartbeat = (resp: HeartbeatResponse, otherFriendlies: string[] = []) => {
        this.operators = resp.operators ?? [];
        this.operatorDisplay = resp.operatorDisplay ?? '';
        this.ranMigrations = resp.ranMigrations;
        this.migrationBlocker = resp.migrationBlocker;

        const fr = resp.friendly;
        if (fr !== undefined) {
            if (otherFriendlies.includes(fr)) {
                this.logger.warn(`Client returned a friendly name that is not unique (${fr}), will fallback to host as friendly (${this.url.host})`);
            } else {
                this.friendly = fr;
            }
        }

        this.subreddits = resp.subreddits;
        //@ts-ignore
        this.bots = resp.bots.map(x => ({...x, instance: this}));
    }

    checkHeartbeat = async (force = false, otherFriendlies: string[] = []) => {
        let shouldCheck = force;
        if (!shouldCheck) {
            if (this.lastCheck === undefined) {
                shouldCheck = true;
            } else {
                const lastCheck = dayjs().diff(dayjs.unix(this.lastCheck), 's');
                if (!this.online) {
                    if (lastCheck > 15) {
                        shouldCheck = true;
                    }
                } else if (lastCheck > 60) {
                    shouldCheck = true;
                }
            }
        }
        if (shouldCheck) {
            this.logger.debug('Starting Heartbeat check');
            this.lastCheck = dayjs().unix();
            const machineToken = jwt.sign({
                data: {
                    machine: true,
                },
            }, this.secret, {
                expiresIn: '1m'
            });

            try {
                const resp = await got.get(`${this.normalUrl}/heartbeat`, {
                    headers: {
                        'Authorization': `Bearer ${machineToken}`,
                    }
                }).json() as CMInstanceInterface;

                this.online = true;
                this.updateFromHeartbeat(resp as HeartbeatResponse, otherFriendlies);
                this.logger.verbose(`Heartbeat detected`);
            } catch (err: any) {
                this.online = false;
                this.error = err.message;
                const badHeartbeat = new ErrorWithCause('Heartbeat response was not ok', {cause: err});
                this.logger.error(badHeartbeat);
            }
        }
    }

}
