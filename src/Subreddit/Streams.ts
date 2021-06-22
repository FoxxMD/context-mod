import { Poll, SnooStormOptions } from "snoostorm"
import Snoowrap from "snoowrap";

export class UnmoderatedStream extends Poll<
    Snoowrap.Submission | Snoowrap.Comment
    > {
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
