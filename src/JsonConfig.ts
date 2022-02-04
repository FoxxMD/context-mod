import {CheckJson, CommentCheckJson, SubmissionCheckJson} from "./Check";
import {ActivityCheckJson, ManagerOptions} from "./Common/interfaces";
import {RunJson} from "./Run";

export interface JSONConfig extends ManagerOptions {
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
    checks?: ActivityCheckJson[]

    /**
     * A list of sets of Checks to run
     * @minItems 1
     * */
    runs?: RunJson[]
}
