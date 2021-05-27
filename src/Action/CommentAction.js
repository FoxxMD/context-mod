"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentAction = void 0;
const index_1 = __importDefault(require("./index"));
class CommentAction extends index_1.default {
    constructor(options) {
        super();
        this.lock = false;
        this.sticky = false;
        this.distinguish = false;
        const { content, lock = false, sticky = false, distinguish = false, } = options;
        this.content = content;
        this.lock = lock;
        this.sticky = sticky;
        this.distinguish = distinguish;
    }
    async handle(item, client) {
    }
}
exports.CommentAction = CommentAction;
//# sourceMappingURL=CommentAction.js.map