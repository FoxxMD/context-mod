import {Logger} from "winston";
import {FilterResult, RunnableBaseOptions, TypedActivityState, TypedActivityStates} from "./interfaces";
import {AuthorCriteria, AuthorOptions, normalizeAuthorCriteria} from "../Author/Author";
import {checkAuthorFilter, checkItemFilter, SubredditResources} from "../Subreddit/SubredditResources";
import {Comment, Submission} from "snoowrap";
import {runCheckOptions} from "../Subreddit/Manager";


export abstract class RunnableBase {

    logger: Logger;
    itemIs: TypedActivityStates;
    authorIs: AuthorOptions;
    resources: SubredditResources;

    constructor(options: RunnableBaseOptions) {
        const {
            resources,
            itemIs = [],
            authorIs: {
                include = [],
                excludeCondition,
                exclude = [],
            } = {},
            logger,
        } = options;

        this.itemIs = itemIs;
        this.authorIs = {
            excludeCondition,
            exclude: exclude.map(x => normalizeAuthorCriteria(x)),
            include: include.map(x => normalizeAuthorCriteria(x)),
        }
        this.resources = resources;
        this.logger = logger;
    }

    async runFilters(activity: (Submission | Comment), options: runCheckOptions): Promise<[(FilterResult<TypedActivityState> | undefined), (FilterResult<AuthorCriteria> | undefined)]> {
        let itemRes: (FilterResult<TypedActivityState> | undefined);
        let authorRes: (FilterResult<AuthorCriteria> | undefined);

        const [itemPass, itemFilterType, itemFilterResults] = await checkItemFilter(activity, this.itemIs, this.resources, this.logger, options.source);
        if (!itemPass) {
            return [itemFilterResults, undefined];
        } else if(this.itemIs.length > 0) {
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
