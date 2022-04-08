import {Check, CheckOptions, userResultCacheDefault, UserResultCacheOptions} from "./index";
import {
    ActivityType,
    CommentState,
    FilterOptions,
    MinimalOrFullFilter,
    RuleResult,
    UserResultCache
} from "../Common/interfaces";
import {Submission, Comment} from "snoowrap/dist/objects";
import { buildFilter } from "../util";

export interface CommentCheckOptions extends CheckOptions {
    itemIs?: MinimalOrFullFilter<CommentState>
    cacheUserResult?: UserResultCacheOptions;
}

export class CommentCheck extends Check {
    itemIs: FilterOptions<CommentState>;
    checkType = 'comment' as ActivityType;

    constructor(options: CommentCheckOptions) {
        super(options);
        this.itemIs = buildFilter(options.itemIs ?? []);
        this.logSummary();
    }

    async getCacheResult(item: Submission | Comment): Promise<UserResultCache | undefined> {
        if (this.cacheUserResult.enable) {
            return await this.resources.getCommentCheckCacheResult(item as Comment, {
                name: this.name,
                authorIs: this.authorIs,
                itemIs: this.itemIs
            })
        }
        return undefined;
    }

    async setCacheResult(item: Submission | Comment, result: UserResultCache): Promise<void> {
        if (this.cacheUserResult.enable) {
            const {result: outcome, ruleResults} = result;

            const res: UserResultCache = {
                result: outcome,
                // don't need to cache rule results if check was not triggered
                // since we only use rule results for actions
                ruleResults: outcome ? ruleResults : []
            };

            await this.resources.setCommentCheckCacheResult(item as Comment, {
                name: this.name,
                authorIs: this.authorIs,
                itemIs: this.itemIs
            }, res, this.cacheUserResult.ttl)
        }
    }
}
