import {Check, CheckOptions, userResultCacheDefault, UserResultCacheOptions} from "./index";
import {CommentState} from "../Common/interfaces";
import {Submission, Comment} from "snoowrap/dist/objects";

export interface CommentCheckOptions extends CheckOptions {
    cacheUserResult?: UserResultCacheOptions;
}

export class CommentCheck extends Check {
    itemIs: CommentState[];

    cacheUserResult: Required<UserResultCacheOptions>;

    constructor(options: CommentCheckOptions) {
        super(options);
        const {
            itemIs = [],
            cacheUserResult = {},
        } = options;

        this.cacheUserResult = {
            ...userResultCacheDefault,
            ...cacheUserResult
        }

        this.itemIs = itemIs;
        this.logSummary();
    }

    logSummary() {
        super.logSummary('comment');
    }

    async getCacheResult(item: Submission | Comment): Promise<boolean | undefined> {
        if (this.cacheUserResult.enable) {
            return await this.resources.getCommentCheckCacheResult(item as Comment, {
                name: this.name,
                authorIs: this.authorIs,
                itemIs: this.itemIs
            })
        }
        return undefined;
    }

    async setCacheResult(item: Submission | Comment, result: boolean): Promise<void> {
        if (this.cacheUserResult.enable) {
            await this.resources.setCommentCheckCacheResult(item as Comment, {
                name: this.name,
                authorIs: this.authorIs,
                itemIs: this.itemIs
            }, result, this.cacheUserResult.ttl)
        }
    }
}
