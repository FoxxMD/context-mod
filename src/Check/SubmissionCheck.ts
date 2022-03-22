import {Check, CheckOptions} from "./index";
import {ActivityType, RuleResult, SubmissionState, UserResultCache} from "../Common/interfaces";
import {Submission, Comment} from "snoowrap/dist/objects";

export class SubmissionCheck extends Check {
    itemIs: SubmissionState[];
    checkType = 'submission' as ActivityType;

    constructor(options: CheckOptions) {
        super(options);
        const {itemIs = []} = options;
        this.itemIs = itemIs;
        this.logSummary();
    }
}
