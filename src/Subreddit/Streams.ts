import {Poll, SnooStormOptions} from "snoostorm"
import Snoowrap, {Listing, RedditContent} from "snoowrap";
import {EventEmitter} from "events";
import {PollConfiguration} from "snoostorm/out/util/Poll";
import {DEFAULT_POLLING_INTERVAL} from "../Common/interfaces";
import {mergeArr, parseDuration, random} from "../util";
import { Logger } from "winston";
import {ErrorWithCause} from "pony-cause";
import dayjs, {Dayjs as DayjsObj} from "dayjs";

type Awaitable<T> = Promise<T> | T;

interface RCBPollingOptions<T> extends SnooStormOptions {
    subreddit: string,
    enforceContinuity?: boolean
    logger: Logger
    name?: string,
    processed?: Set<T[keyof T]>
    label?: string
    dateCutoff?: boolean
}

interface RCBPollConfiguration<T> extends PollConfiguration<T>,RCBPollingOptions<T> {
    get: () => Promise<Listing<T>>
    dateCutoff: boolean
}

export class SPoll<T extends RedditContent<object>> extends Poll<T> {
    identifier: keyof T;
    getter: () => Promise<Listing<T>>;
    frequency;
    running: boolean = false;
    // intention of newStart is to make polling behavior such that only "new" items AFTER polling has started get emitted
    // -- that is, we don't want to emit the items we immediately fetch on a fresh poll start since they existed "before" polling started
    newStart: boolean = true;
    enforceContinuity: boolean;
    useDateCutoff: boolean;
    dateCutoff?: DayjsObj;
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
            processed,
            dateCutoff,
        } = options;
        this.subreddit = subreddit;
        this.name = name !== undefined ? name : this.name;
        this.logger = logger.child({labels: [label, this.name]}, mergeArr)
        this.identifier = identifier;
        this.getter = get;
        this.frequency = frequency;
        this.enforceContinuity = enforceContinuity;
        this.useDateCutoff = dateCutoff;

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
                            self.logger.debug(`Did not find any already seen Activities and continuity is enforced. This probably means there were more new Activities than 1 api call can return. Fetching next page (page ${page})...`);
                            // @ts-ignore
                            batch = await batch.fetchMore({amount: 100});
                        }
                        if(batch.length === 0 || batch.isFinished) {
                            // if nothing is returned we don't want to end up in an endless loop!
                            anyAlreadySeen = true;
                        }
                        for (const item of batch) {
                            const id = item[self.identifier];
                            if (self.processed.has(id)) {
                                anyAlreadySeen = true;
                                continue;
                            }

                            // add new item to list and set as processed
                            newItems.push(item);
                            self.processed.add(id);
                        }
                        page++;
                    }

                    if(self.newStart) {

                        self.logger.debug(`Found ${newItems.length} unseen Activities out of ${batch.length} returned, but will ignore all on first start.`);
                        self.emit("listing", []);

                        if(self.useDateCutoff && self.dateCutoff === undefined) {
                            self.logger.debug('Cutoff date should be used for filtering unseen Activities but none was set. Will determine date based on newest Activity returned from first polling results.');
                            if(newItems.length === 0) {
                                // no items found, cutoff is now
                                self.dateCutoff = dayjs();
                                self.logger.debug(`Cutoff date set to NOW (${self.dateCutoff.format('YYYY-MM-DD HH:mm:ssZ')}) since no unseen Activities returned. Unseen Activities will only be returned if newer than this date.`);
                            } else {
                                // set cutoff date for new items from the newest items found
                                const sorted = [...newItems];
                                sorted.sort((a, z) => z.created_utc - a.created_utc);
                                self.dateCutoff = dayjs.unix(sorted[0].created_utc);
                                self.logger.debug(`Cutoff date set to newest unseen Activity found, ${self.dateCutoff.format('YYYY-MM-DD HH:mm:ssZ')}. Unseen Activities will only be returned if newer than this date.`);
                            }
                        }

                    } else {

                        // applies mostly (only?) to 'unmoderated' polling
                        //
                        // scenario:
                        // * polling unmoderated for many subreddits and unmoderated has not been clearing out for awhile so it has many (100's) of items
                        // * a moderator, or CM, iterates through list and actions items so the list is shorter
                        // * CM polling unmoderated and finds "unseen" items that don't appear in unprocessed list
                        //
                        // these "unseen" are OLDER than the "newest" seen items we have got from polling because CM only got the first page of unmoderated items
                        // so now CM emits them as "new" and CM starts processing them. If it continues to process them then more and more 'unseen old' items continue to appear in stream,
                        // creating a feedback loop where CM eventually processes the entire backlog of unmoderated items
                        //
                        // this is UNWANTED behavior. CM should only ever process items added to polling sources after it starts monitoring them.
                        //
                        // to address this we use a cutoff date determined from the newest activity returned from the first polling call (or current datetime if none returned)
                        // then we make sure any 'new' items (unseen by CM) are newer than this cutoff date
                        //
                        // -- this is the default behavior for all polling sources except modqueue. See comments on that class below for why.
                        const unixCutoff = self.useDateCutoff && self.dateCutoff !== undefined ? self.dateCutoff.unix() : undefined;
                        const validNewItems = unixCutoff === undefined || newItems.length === 0 ? newItems : newItems.filter(x => x.created_utc >= unixCutoff);

                        if(validNewItems.length !== newItems.length && self.dateCutoff !== undefined) {
                            self.logger.warn(`${newItems.length - validNewItems.length} unseen Activities were created before cutoff date (${self.dateCutoff.format('YYYY-MM-DD HH:mm:ssZ')}) and have been filtered out.`);
                        }
                        self.logger.debug(`Found ${validNewItems.length} valid, unseen Activities out of ${batch.length} returned`);

                        // only emit if not new start since we are "buffering" already existing activities
                        for(const item of validNewItems) {
                            self.emit('item', item);
                        }

                        // Emit the new listing of all new items
                        self.emit("listing", validNewItems);
                    }
                    // no longer new start on n+1 interval
                    self.newStart = false;
                    // if everything succeeded then create a new timeout
                    self.createInterval();
                } catch (err: any) {
                    self.running = false;
                    self.logger.error(new ErrorWithCause('Polling Interval stopped due to error encountered', {cause: err}));
                    self.emit('error', err);
                }
            }
        })(this), random(this.frequency - 1, this.frequency + 1));
    }

    // allow controlling newStart state
    startInterval = (newStartState?: boolean, msg?: string) => {
        this.running = true;
        if(newStartState !== undefined) {
            this.newStart = newStartState;
        }
        const startMsg = `Polling Interval Started${msg !== undefined ? `: ${msg}` : ''}`;
        this.logger.debug(startMsg)
        this.createInterval();
    }

    end = (reason?: string) => {
        let msg ='Stopping Polling Interval';
        if(reason !== undefined) {
            msg += `: ${reason}`;
        }
        this.logger.debug(msg);
        this.running = false;
        this.newStart = true;
        this.dateCutoff = undefined;
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
            dateCutoff: true,
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
            // cannot use cutoff date since 'new' items in this list are based on when they were reported, not when the item was created
            // and unfortunately there is no way to use that "reported at" time since reddit doesn't include it in the returned items
            dateCutoff: false,
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
            dateCutoff: true,
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
            dateCutoff: true,
            ...options,
        });
    }
}
