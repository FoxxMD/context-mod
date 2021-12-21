import {Poll, SnooStormOptions} from "snoostorm"
import Snoowrap from "snoowrap";
import {EventEmitter} from "events";
import {PollConfiguration} from "snoostorm/out/util/Poll";
import {ClearProcessedOptions, DEFAULT_POLLING_INTERVAL} from "../Common/interfaces";
import dayjs, {Dayjs} from "dayjs";
import { Duration } from "dayjs/plugin/duration";
import {parseDuration, setRandomInterval, sleep} from "../util";

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

    startInterval = () => {
        this.running = true;
        this.randInterval = setRandomInterval((function (self) {
            return async () => {
                try {
                    // DEBUGGING
                    //
                    // Removing processed clearing to see if it fixes weird, duplicate/delayed comment processing behavior
                    //
                    // clear the tracked, processed activity ids after a set period or number of activities have been processed
                    // because when RCB is long-running and has streams from high-volume subreddits this list never gets smaller...

                    // so clear if after time period
                    // if ((self.clearProcessedAfter !== undefined && dayjs().isSameOrAfter(self.clearProcessedAfter))
                    //     // or clear if processed list is larger than defined max allowable size (default setting, 2 * polling option limit)
                    //     || (self.clearProcessedSize !== undefined && self.processed.size >= self.clearProcessedSize)) {
                    //     if (self.retainProcessed === 0) {
                    //         self.processed = new Set();
                    //     } else {
                    //         // retain some processed so we have continuity between processed list resets -- this is default behavior and retains polling option limit # of activities
                    //         // we can slice from the set here because ID order is guaranteed for Set object so list is oldest -> newest
                    //         // -- retain last LIMIT number of activities (or all if retain # is larger than list due to user config error)
                    //         self.processed = new Set(Array.from(self.processed).slice(Math.max(0, self.processed.size - self.retainProcessed)));
                    //     }
                    //     // reset time interval if there is one
                    //     if (self.clearProcessedAfter !== undefined && self.clearProcessedDuration !== undefined) {
                    //         self.clearProcessedAfter = dayjs().add(self.clearProcessedDuration.asSeconds(), 's');
                    //     }
                    // }
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
                } catch (err: any) {
                    self.emit('error', err);
                    self.end();
                }
            }
        })(this), this.frequency - 1, this.frequency + 1);
    }

    end = () => {
        this.running = false;
        if(this.randInterval !== undefined) {
            this.randInterval.clear();
        }
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
