import {Poll, SnooStormOptions} from "snoostorm"
import Snoowrap from "snoowrap";
import {EventEmitter} from "events";
import {PollConfiguration} from "snoostorm/out/util/Poll";
import {ClearProcessedOptions, DEFAULT_POLLING_INTERVAL} from "../Common/interfaces";
import dayjs, {Dayjs} from "dayjs";
import { Duration } from "dayjs/plugin/duration";
import {parseDuration, random} from "../util";

type Awaitable<T> = Promise<T> | T;

interface RCBPollingOptions extends SnooStormOptions {
    subreddit: string,
    clearProcessed?: ClearProcessedOptions
}

interface RCBPollConfiguration<T> extends PollConfiguration<T> {
    clearProcessed?: ClearProcessedOptions
}

export class SPoll<T extends object> extends Poll<T> {
    identifier: keyof T;
    getter: () => Awaitable<T[]>;
    frequency;
    running: boolean = false;
    clearProcessedDuration?: Duration;
    clearProcessedSize?: number;
    clearProcessedAfter?: Dayjs;
    retainProcessed: number = 0;
    randInterval?: { clear: () => void };

    constructor(options: RCBPollConfiguration<T>) {
        super(options);
        this.identifier = options.identifier;
        this.getter = options.get;
        this.frequency = options.frequency;
        const {
            after,
            size,
            retain = 0,
        } = options.clearProcessed || {};
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
                    const batch = await self.getter();
                    const newItems: T[] = [];
                    for (const item of batch) {
                        const id = item[self.identifier];
                        if (self.processed.has(id)) continue;

                        // Emit for new items and add it to the list
                        newItems.push(item);
                        self.processed.add(id);
                        self.emit("item", item);
                    }

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
            clearProcessed: options.clearProcessed
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
            clearProcessed: options.clearProcessed
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
            clearProcessed: options.clearProcessed
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
            clearProcessed: options.clearProcessed
        });
    }
}
