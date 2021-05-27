"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.actionFactory = exports.Action = void 0;
const CommentAction_1 = require("./CommentAction");
const LockAction_1 = __importDefault(require("./LockAction"));
const RemoveAction_1 = require("./RemoveAction");
const ReportAction_1 = require("./ReportAction");
const FlairAction_1 = require("./SubmissionAction/FlairAction");
class Action {
}
exports.Action = Action;
exports.default = Action;
function actionFactory(config) {
    switch (config.kind) {
        case 'comment':
            return new CommentAction_1.CommentAction(config);
        case 'lock':
            return new LockAction_1.default();
        case 'remove':
            return new RemoveAction_1.RemoveAction();
        case 'report':
            return new ReportAction_1.ReportAction(config);
        case 'flair':
            return new FlairAction_1.FlairAction(config);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
exports.actionFactory = actionFactory;
//# sourceMappingURL=index.js.map