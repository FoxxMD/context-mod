"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportAction = void 0;
const index_1 = __importDefault(require("./index"));
class ReportAction extends index_1.default {
    constructor(options) {
        super();
        this.content = options.content;
    }
    async handle(item, client) {
    }
}
exports.ReportAction = ReportAction;
//# sourceMappingURL=ReportAction.js.map