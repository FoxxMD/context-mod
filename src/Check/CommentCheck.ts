import {Check, CheckOptions} from "./index";
import {CommentState} from "../Common/interfaces";

export class CommentCheck extends Check {
    itemIs: CommentState[];

    constructor(options: CheckOptions) {
        super(options);
        const {itemIs = []} = options;
        this.itemIs = itemIs;
        this.logSummary('comment');
    }
}
