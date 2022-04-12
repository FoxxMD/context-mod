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
import {CheckResultEntity} from "../Common/Entities/CheckResultEntity";

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

    async getCacheResult(item: Submission | Comment, partialResult: CheckResultEntity): Promise<CheckResultEntity | undefined> {
        if (this.cacheUserResult.enable) {
            const res = await this.resources.getCommentCheckCacheResult(item as Comment, {
                name: this.name,
                authorIs: this.authorIs,
                itemIs: this.itemIs
            });
            if(res === undefined) {
                return undefined;
            }
            partialResult.triggered = res.triggered;

            if(res instanceof CheckResultEntity) {
                partialResult.ruleResults = res.ruleResults;
                partialResult.ruleSetResults = res.ruleSetResults;
            } else {
                partialResult.results = res.results;
            }
            return partialResult;
        }
        return undefined;
    }

    async setCacheResult(item: Submission | Comment, result: CheckResultEntity): Promise<void> {
        if (this.cacheUserResult.enable) {
            // const {result: outcome, ruleResults} = result;
            //
            // const res: UserResultCache = {
            //     result: outcome,
            //     // don't need to cache rule results if check was not triggered
            //     // since we only use rule results for actions
            //     ruleResults: outcome ? ruleResults : []
            // };

            await this.resources.setCommentCheckCacheResult(item as Comment, {
                name: this.name,
                authorIs: this.authorIs,
                itemIs: this.itemIs
            }, result, this.cacheUserResult.ttl)
        }
    }
}
