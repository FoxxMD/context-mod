"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentCheck = void 0;
const index_1 = require("./index");
class CommentCheck extends index_1.Check {
    constructor(options) {
        super(options);
        const { itemIs = [] } = options;
        this.itemIs = itemIs;
    }
}
exports.CommentCheck = CommentCheck;
//# sourceMappingURL=CommentCheck.js.map