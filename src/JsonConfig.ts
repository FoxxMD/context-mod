import {CheckJSONConfig} from "./Check";

export interface JSONConfig {
    /**
     * A list of all the checks that should be run for a subreddit. Checks are split into two lists -- submission or comment -- based on kind and run independently. Checks in each list are run in the order found in the configuration. When a check "passes" and actions are performed any subsequent checks are skipped.
     * @minItems 1
     * */
    checks: CheckJSONConfig[]
}
