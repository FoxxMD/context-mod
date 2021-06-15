"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubmissionCheck = void 0;
const index_1 = require("./index");
class SubmissionCheck extends index_1.Check {
    constructor(options) {
        super(options);
        const { itemIs = [] } = options;
        this.itemIs = itemIs;
    }
}
exports.SubmissionCheck = SubmissionCheck;
//# sourceMappingURL=SubmissionCheck.js.map