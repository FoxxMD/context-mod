import {Check, CheckOptions} from "./index";
import {SubmissionState} from "../Common/interfaces";
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

    async getCacheResult(item: Submission | Comment) {
        return undefined;
    }

    async setCacheResult(item: Submission | Comment, result: boolean) {
    }
}
