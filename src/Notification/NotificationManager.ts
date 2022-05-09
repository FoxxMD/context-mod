import {
    NotificationConfig,
    NotificationEventConfig,
    NotificationEvents,
    Notifier
} from "../Common/interfaces";
import DiscordNotifier from "./DiscordNotifier";
import {Logger} from "winston";
import {mergeArr} from "../util";
import Subreddit from "snoowrap/dist/objects/Subreddit";
import {NotificationEventType} from "../Common/Typings/Atomic";

class NotificationManager {
    notifiers: Notifier[] = [];
    events: NotificationEvents = [];
    logger: Logger;
    subreddit: Subreddit;
    name: string;

    constructor(logger: Logger, subreddit: Subreddit, displayName: string, botName: string, config?: NotificationConfig) {
        this.logger = logger.child({leaf: 'Notifications'}, mergeArr);
        this.subreddit = subreddit;
        this.name = displayName;
        if (config !== undefined) {
            const {events = [], providers = []} = config;
            this.events = events;
            for (const p of providers) {
                switch (p.type) {
                    case 'discord':
                        this.notifiers.push(new DiscordNotifier(p.name, botName, p.url));
                        break;
                    default:
                        this.logger.warn(`Notification provider type of ${p.type} not recognized.`);
                        break;
                }
            }
            if (this.events.length > 0 && this.notifiers.length === 0) {
                this.logger.warn(`Config specified ${this.events.length} event hooks but not notification providers were setup!`);
            }
        }
    }

    getStats() {
        let notifiers: string[] = [];
        if (this.notifiers.length > 0) {
            notifiers = this.notifiers.map(x => `${x.name} (${x.type})`);
        }
        let events: string[] = [];
        if (this.events.length > 0) {
            events = this.events.reduce((acc: string[], curr) => {
                const e = Array.isArray(curr) ? curr : curr.types;
                for (const ev of e) {
                    if (!acc.includes(ev)) {
                        acc.push(ev);
                    }
                }
                return acc;
            }, []);
        }

        return {
            notifiers,
            events,
        }
    }

    async handle(name: NotificationEventType, title: string, body?: string, causedBy?: string, logLevel?: string) {

        if (this.notifiers.length === 0 || this.events.length === 0) {
            return;
        }

        let notifiers: Notifier[] = [];
        for (const e of this.events) {
            // array of event NotificationEventType
            if (Array.isArray(e)) {
                const ev = e as NotificationEventType[];
                for (const v of ev) {
                    if (v === name) {
                        // if we find the event here then we want to sent the event to all configured notifiers
                        notifiers = notifiers.concat(this.notifiers);
                    }
                }
            } else {
                // e is a NotificationEventConfig
                const ev = e as NotificationEventConfig;
                const hasEvent = ev.types.some(x => x === name);
                if (hasEvent) {
                    const p = ev.providers.map(y => y.toLowerCase());
                    const validNotifiers = this.notifiers.filter(x => p.includes(x.name.toLowerCase()));
                    notifiers = notifiers.concat(validNotifiers);
                }
            }
        }
        // remove dups
        notifiers = notifiers.reduce((acc: Notifier[], curr: Notifier) => {
            if (!acc.some(x => x.name === curr.name)) {
                return acc.concat(curr);
            }
            return acc;
        }, []);

        let footer = [];
        if (causedBy !== undefined) {
            footer.push(`* Performed by "${causedBy}"`);
        }
        footer.push(`* Notification triggered by "${name}"`);

        this.logger.info(`Sending notification for ${name} to providers: ${notifiers.map(x => `${x.name} (${x.type})`).join(', ')}`);

        for (const n of notifiers) {
            await n.handle({
                title: `${title} (${this.name})`,
                body: body || '',
                footer: footer.length > 0 ? footer.join('\n') : undefined,
                logLevel
            });
        }
    }
}

export default NotificationManager;
