import {Check, CheckOptions} from "./index";
import {RuleResult, SubmissionState, UserResultCache} from "../Common/interfaces";
import {Submission, Comment} from "snoowrap/dist/objects";

export class SubmissionCheck extends Check {
    itemIs: SubmissionState[];

    constructor(options: CheckOptions) {
        super(options);
        const {itemIs = []} = options;
        this.itemIs = itemIs;
        this.logSummary();
    }

    logSummary() {
        super.logSummary('submission');
    }
}
