"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlairAction = void 0;
const index_1 = __importDefault(require("../index"));
class FlairAction extends index_1.default {
    constructor(options) {
        super();
        if (options.text === undefined && options.css === undefined) {
            throw new Error('Must define either text or css on FlairAction');
        }
        this.text = options.text;
        this.css = options.css;
    }
    async handle(item, client) {
    }
}
exports.FlairAction = FlairAction;
//# sourceMappingURL=FlairAction.js.map