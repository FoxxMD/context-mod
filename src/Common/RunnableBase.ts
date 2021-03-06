import {Logger} from "winston";
import {checkAuthorFilter, checkItemFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {Comment, Submission} from "snoowrap";
import {runCheckOptions} from "../Subreddit/Manager";
import {buildFilter} from "../util";
import {AuthorCriteria, TypedActivityState} from "./Infrastructure/Filters/FilterCriteria";
import {RunnableBaseOptions} from "./Infrastructure/Runnable";
import {AuthorOptions, FilterResult, ItemOptions} from "./Infrastructure/Filters/FilterShapes";


export abstract class RunnableBase {

    logger: Logger;
    itemIs: ItemOptions;
    authorIs: AuthorOptions;
    resources: SubredditResources;

    constructor(options: RunnableBaseOptions) {
        const {
            resources,
            itemIs = [],
            authorIs = [],
            logger,
        } = options;

        this.itemIs = buildFilter(itemIs);
        this.authorIs = buildFilter(authorIs)
        this.resources = resources;
        this.logger = logger;
    }

    async runFilters(activity: (Submission | Comment), options: runCheckOptions): Promise<[(FilterResult<TypedActivityState> | undefined), (FilterResult<AuthorCriteria> | undefined)]> {
        let itemRes: (FilterResult<TypedActivityState> | undefined);
        let authorRes: (FilterResult<AuthorCriteria> | undefined);

        const [itemPass, itemFilterType, itemFilterResults] = await checkItemFilter(activity, this.itemIs, this.resources, {source: options.source, logger: this.logger});
        if (!itemPass) {
            return [itemFilterResults, undefined];
        } else if(itemFilterType !== undefined) {
            itemRes = itemFilterResults;
        }
        const [authPass, authFilterType, authorFilterResults] = await checkAuthorFilter(activity, this.authorIs, this.resources, this.logger);
        if(!authPass) {
            return [itemRes, authorFilterResults];
        } else if(authFilterType !== undefined) {
            authorRes = authorFilterResults;
        }
        return [itemRes, authorRes];
    }
}
