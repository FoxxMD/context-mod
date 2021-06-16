
import {Check, CheckOptions} from "./index";
import {SubmissionState} from "../Common/interfaces";

export class SubmissionCheck extends Check {
    itemIs: SubmissionState[];

    constructor(options: CheckOptions) {
        super(options);
        const {itemIs = []} = options;
        this.itemIs = itemIs;
        this.logSummary('submission');
    }
}
