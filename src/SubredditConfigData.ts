import {
    ActivityCheckConfigValue,
} from "./Check";
import {ManagerOptions} from "./Common/interfaces";
import {RunConfigHydratedData, RunConfigValue, RunConfigObject} from "./Run";

export interface SubredditConfigData extends ManagerOptions {
    /**
     * A list of all the checks that should be run for a subreddit.
     *
     * Checks are split into two lists -- submission or comment -- based on kind and run independently.
     *
     * Checks in each list are run in the order found in the configuration.
     *
     * When a check "passes", and actions are performed, then all subsequent checks are skipped.
     * @minItems 1
     * */
    checks?: ActivityCheckConfigValue[]

    /**
     * A list of sets of Checks to run
     * @minItems 1
     * */
    runs?: RunConfigValue[]
}

export interface SubredditConfigHydratedData extends Omit<SubredditConfigData, 'checks'> {
    runs?: RunConfigHydratedData[]
}

export interface SubredditConfigObject extends SubredditConfigHydratedData {
    runs?: RunConfigObject[]
}
