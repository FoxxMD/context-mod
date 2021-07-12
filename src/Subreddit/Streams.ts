import {Poll, SnooStormOptions} from "snoostorm"
import Snoowrap from "snoowrap";
import {EventEmitter} from "events";
import {PollConfiguration} from "snoostorm/out/util/Poll";

type Awaitable<T> = Promise<T> | T;

class SPoll<T extends object> extends Poll<T> {
    identifier: keyof T;
    getter: () => Awaitable<T[]>;
    frequency;

    constructor(options: PollConfiguration<T>) {
        super(options);
        this.identifier = options.identifier;
        this.getter = options.get;
        this.frequency = options.frequency;
        clearInterval(this.interval);
        this.startInterval();
    }

    startInterval = () => {
        this.interval = setInterval(async () => {
            try {
                const batch = await this.getter();

                const newItems: T[] = [];
                for (const item of batch) {
                    const id = item[this.identifier];
                    if (this.processed.has(id)) continue;

                    // Emit for new items and add it to the list
                    newItems.push(item);
                    this.processed.add(id);
                    this.emit("item", item);
                }

                // Emit the new listing of all new items
                this.emit("listing", newItems);
            } catch (err) {
                
                this.emit('error', err);
            }
        }, this.frequency);
    }
}

export class UnmoderatedStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: SnooStormOptions & { subreddit: string }) {
        super({
            frequency: options.pollTime || 20000,
            get: async () => client.getSubreddit(options.subreddit).getUnmoderated(options),
            identifier: "id",
        });
    }
}
