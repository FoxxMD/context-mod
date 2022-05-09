import {Check, CheckOptions} from "./index";
import {
    RuleResult,
    UserResultCache
} from "../Common/interfaces";
import {Submission, Comment} from "snoowrap/dist/objects";
import {buildFilter} from "../util";
import {FilterOptions, MinimalOrFullFilter} from "../Common/Infrastructure/Filters/FilterShapes";
import {SubmissionState} from "../Common/Infrastructure/Filters/FilterCriteria";
import {ActivityType} from "../Common/Infrastructure/Reddit";

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
