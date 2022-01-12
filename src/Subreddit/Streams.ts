import {Poll, SnooStormOptions} from "snoostorm"
import Snoowrap from "snoowrap";
import {EventEmitter} from "events";
import {PollConfiguration} from "snoostorm/out/util/Poll";
import {ClearProcessedOptions, DEFAULT_POLLING_INTERVAL} from "../Common/interfaces";
import dayjs, {Dayjs} from "dayjs";
import { Duration } from "dayjs/plugin/duration";
import {mergeArr, parseDuration, random} from "../util";
import { Logger } from "winston";

type Awaitable<T> = Promise<T> | T;

interface RCBPollingOptions extends SnooStormOptions {
    subreddit: string,
    clearProcessed?: ClearProcessedOptions
    enforceContinuity?: boolean
    logger: Logger
    name?: string
}

interface RCBPollConfiguration<T> extends PollConfiguration<T> {
    clearProcessed?: ClearProcessedOptions
    enforceContinuity?: boolean
    logger: Logger
    name?: string
}

export class SPoll<T extends object> extends Poll<T> {
    identifier: keyof T;
    getter: () => Awaitable<T[]>;
    frequency;
    running: boolean = false;
    newStart: boolean = true;
    enforceContinuity: boolean;
    clearProcessedDuration?: Duration;
    clearProcessedSize?: number;
    clearProcessedAfter?: Dayjs;
    retainProcessed: number = 0;
    randInterval?: { clear: () => void };
    name: string = 'Reddit Stream';
    logger: Logger;

    constructor(options: RCBPollConfiguration<T>) {
        super(options);
        const {
            identifier,
            get,
            frequency,
            clearProcessed = {},
            enforceContinuity = false,
            logger,
            name,
        } = options;
        this.name = name !== undefined ? name : this.name;
        this.logger = logger.child({labels: [`Polling`, this.name]}, mergeArr)
        this.identifier = identifier;
        this.getter = get;
        this.frequency = frequency;
        this.enforceContinuity = enforceContinuity;
        const {
            after,
            size,
            retain = 0,
        } = clearProcessed || {};
        if(after !== undefined) {
            this.clearProcessedDuration = parseDuration(after);
        }
        this.clearProcessedSize = size;
        this.retainProcessed = retain;
        if (this.clearProcessedDuration !== undefined) {
            this.clearProcessedAfter = dayjs().add(this.clearProcessedDuration.asSeconds(), 's');
        }
        clearInterval(this.interval);
    }

    createInterval = () => {
        this.interval = setTimeout((function (self) {
            return async () => {
                try {
                    self.logger.debug('Polling...');
                    let batch = await self.getter();
                    const newItems: T[] = [];
                    let anyAlreadySeen = false;
                    let page = 1;
                    while(page === 1 || (self.enforceContinuity && !self.newStart && !anyAlreadySeen)) {
                        if(page !== 1) {
                            self.logger.debug(`Did not find any already seen activities and continuity is enforced. This probably means there were more new items than 1 api call can return. Fetching next page (${page})...`);
                            // @ts-ignore
                            batch = await batch.fetchMore({amount: 100});
                        }
                        for (const item of batch) {
                            const id = item[self.identifier];
                            if (self.processed.has(id)) {
                                anyAlreadySeen = true;
                                continue;
                            }

                            // Emit for new items and add it to the list
                            newItems.push(item);
                            self.processed.add(id);
                            self.emit("item", item);
                        }
                        page++;
                    }
                    self.newStart = false;
                    self.logger.debug(`Found ${newItems.length} new items`);
                    // Emit the new listing of all new items
                    self.emit("listing", newItems);

                    // if everything succeeded then create a new timeout
                    self.createInterval();
                } catch (err: any) {
                    self.emit('error', err);
                }
            }
        })(this), random(this.frequency - 1, this.frequency + 1));
    }

    startInterval = () => {
        this.running = true;
        this.createInterval();
    }

    end = () => {
        this.running = false;
        this.newStart = true;
        super.end();
    }
}

export class UnmoderatedStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: RCBPollingOptions) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getSubreddit(options.subreddit).getUnmoderated(options),
            identifier: "id",
            clearProcessed: options.clearProcessed,
            enforceContinuity: options.enforceContinuity,
            logger: options.logger,
            name: 'Unmoderated',
        });
    }
}

export class ModQueueStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: RCBPollingOptions) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getSubreddit(options.subreddit).getModqueue(options),
            identifier: "id",
            clearProcessed: options.clearProcessed,
            enforceContinuity: options.enforceContinuity,
            logger: options.logger,
            name: 'Modqueue'
        });
    }
}

export class SubmissionStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: RCBPollingOptions) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getNew(options.subreddit, options),
            identifier: "id",
            clearProcessed: options.clearProcessed,
            enforceContinuity: options.enforceContinuity,
            logger: options.logger,
            name: 'Submission'
        });
    }
}

export class CommentStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: RCBPollingOptions) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getNewComments(options.subreddit, options),
            identifier: "id",
            clearProcessed: options.clearProcessed,
            enforceContinuity: options.enforceContinuity,
            logger: options.logger,
            name: 'Comment'
        });
    }
}
