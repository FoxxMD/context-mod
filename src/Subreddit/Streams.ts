import {Poll, SnooStormOptions} from "snoostorm"
import Snoowrap from "snoowrap";
import {EventEmitter} from "events";
import {PollConfiguration} from "snoostorm/out/util/Poll";
import {DEFAULT_POLLING_INTERVAL} from "../Common/interfaces";
import {mergeArr, parseDuration, random} from "../util";
import { Logger } from "winston";

type Awaitable<T> = Promise<T> | T;

interface RCBPollingOptions<T> extends SnooStormOptions {
    subreddit: string,
    enforceContinuity?: boolean
    logger: Logger
    name?: string,
    processed?: Set<T[keyof T]>
    label?: string
}

interface RCBPollConfiguration<T> extends PollConfiguration<T>,RCBPollingOptions<T> {
}

export class SPoll<T extends object> extends Poll<T> {
    identifier: keyof T;
    getter: () => Awaitable<T[]>;
    frequency;
    running: boolean = false;
    // intention of newStart is to make polling behavior such that only "new" items AFTER polling has started get emitted
    // -- that is, we don't want to emit the items we immediately fetch on a fresh poll start since they existed "before" polling started
    newStart: boolean = true;
    enforceContinuity: boolean;
    randInterval?: { clear: () => void };
    name: string = 'Reddit Stream';
    logger: Logger;
    subreddit: string;

    constructor(options: RCBPollConfiguration<T>) {
        super(options);
        const {
            identifier,
            get,
            frequency,
            enforceContinuity = false,
            logger,
            name,
            subreddit,
            label = 'Polling',
            processed
        } = options;
        this.subreddit = subreddit;
        this.name = name !== undefined ? name : this.name;
        this.logger = logger.child({labels: [label, this.name]}, mergeArr)
        this.identifier = identifier;
        this.getter = get;
        this.frequency = frequency;
        this.enforceContinuity = enforceContinuity;

        // if we pass in processed on init the intention is to "continue" from where the previous stream left off
        // WITHOUT new start behavior
        if (processed !== undefined) {
            this.processed = processed;
            this.newStart = false;
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
                    // initial iteration should always run
                    // but only continue iterating if stream enforces continuity and we've only seen new items so far
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
                            // but don't emit on new start since we are "buffering" already existing activities
                            if(!self.newStart) {
                                self.emit("item", item);
                            }
                        }
                        page++;
                    }
                    const newItemMsg = `Found ${newItems.length} new items`;
                    if(self.newStart) {
                        self.logger.debug(`${newItemMsg} but will ignore all on first start.`);
                        self.emit("listing", []);
                    } else {
                        self.logger.debug(newItemMsg);
                        // Emit the new listing of all new items
                        self.emit("listing", newItems);
                    }
                    // no longer new start on n+1 interval
                    self.newStart = false;
                    // if everything succeeded then create a new timeout
                    self.createInterval();
                } catch (err: any) {
                    self.emit('error', err);
                }
            }
        })(this), random(this.frequency - 1, this.frequency + 1));
    }

    // allow controlling newStart state
    startInterval = (newStartState?: boolean) => {
        this.running = true;
        if(newStartState !== undefined) {
            this.newStart = newStartState;
        }
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
        options: RCBPollingOptions<Snoowrap.Submission | Snoowrap.Comment>) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getSubreddit(options.subreddit).getUnmoderated(options),
            identifier: "id",
            name: 'Unmoderated',
            ...options,
        });
    }
}

export class ModQueueStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: RCBPollingOptions<Snoowrap.Submission | Snoowrap.Comment>) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getSubreddit(options.subreddit).getModqueue(options),
            identifier: "id",
            name: 'Modqueue',
            ...options,
        });
    }
}

export class SubmissionStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: RCBPollingOptions<Snoowrap.Submission | Snoowrap.Comment>) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getNew(options.subreddit, options),
            identifier: "id",
            name: 'Submission',
            ...options,
        });
    }
}

export class CommentStream extends SPoll<Snoowrap.Submission | Snoowrap.Comment> {
    constructor(
        client: Snoowrap,
        options: RCBPollingOptions<Snoowrap.Submission | Snoowrap.Comment>) {
        super({
            frequency: options.pollTime || DEFAULT_POLLING_INTERVAL * 1000,
            get: async () => client.getNewComments(options.subreddit, options),
            identifier: "id",
            name: 'Comment',
            ...options,
        });
    }
}
