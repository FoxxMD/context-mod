import {Logger} from "winston";
import {
    AuthorOptions, FilterResult, ItemOptions, RunnableBaseOptions
} from "./interfaces";
import {checkAuthorFilter, checkItemFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {Comment, Submission} from "snoowrap";
import {runCheckOptions} from "../Subreddit/Manager";
import {buildFilter} from "../util";
import {AuthorCriteria, TypedActivityState} from "./Infrastructure/Filters/FilterCriteria";


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

        const [itemPass, itemFilterType, itemFilterResults] = await checkItemFilter(activity, this.itemIs, this.resources, this.logger, options.source);
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
