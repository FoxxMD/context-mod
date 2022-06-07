import {MinimalOrFullFilter, MinimalOrFullFilterJson} from "./Filters/FilterShapes";
import {AuthorCriteria, TypedActivityState} from "./Filters/FilterCriteria";
import {Logger} from "winston";
import {SubredditResources} from "../../Subreddit/SubredditResources";

export interface RunnableBaseOptions extends Omit<RunnableBaseJson, 'itemIs' | 'authorIs'> {
    logger: Logger;
    resources: SubredditResources
    itemIs?: MinimalOrFullFilter<TypedActivityState>
    authorIs?: MinimalOrFullFilter<AuthorCriteria>
}

export interface StructuredRunnableBase {
    itemIs?: MinimalOrFullFilter<TypedActivityState>
    authorIs?: MinimalOrFullFilter<AuthorCriteria>
}

export interface RunnableBaseJson {
    /**
     * A list of criteria to test the state of the `Activity` against before running the check.
     *
     * If any set of criteria passes the Check will be run. If the criteria fails then the Check will fail.
     *
     * * @examples [[{"over_18": true, "removed': false}]]
     *
     * */
    itemIs?: MinimalOrFullFilterJson<TypedActivityState>

    /**
     * If present then these Author criteria are checked before running the Check. If criteria fails then the Check will fail.
     * */
    authorIs?: MinimalOrFullFilterJson<AuthorCriteria>
}
