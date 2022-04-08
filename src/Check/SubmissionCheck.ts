import {Check, CheckOptions} from "./index";
import {
    ActivityType,
    FilterOptions,
    MinimalOrFullFilter,
    RuleResult,
    SubmissionState,
    UserResultCache
} from "../Common/interfaces";
import {Submission, Comment} from "snoowrap/dist/objects";
import {buildFilter} from "../util";

export interface SubmissionCheckOptions extends CheckOptions {
    itemIs?: MinimalOrFullFilter<SubmissionState>
}

export class SubmissionCheck extends Check {
    itemIs: FilterOptions<SubmissionState>;
    checkType = 'submission' as ActivityType;

    constructor(options: SubmissionCheckOptions) {
        super(options);
        const {itemIs = []} = options;
        this.itemIs = buildFilter(itemIs);
        this.logSummary();
    }
}
