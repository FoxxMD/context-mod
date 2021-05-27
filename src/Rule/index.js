"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleFactory = exports.Author = exports.Rule = void 0;
const RecentActivityRule_1 = require("./RecentActivityRule");
const RepeatSubmissionRule_1 = __importDefault(require("./SubmissionRule/RepeatSubmissionRule"));
class Rule {
    constructor(options) {
        this.authors = { exclude: [], include: [] };
        this.name = options.name;
        if (options.authors !== undefined) {
            const { exclude = [], include = [] } = options.authors;
            this.authors.exclude = exclude.map(x => new Author(x));
            this.authors.include = include.map(x => new Author(x));
        }
    }
}
exports.Rule = Rule;
class Author {
    constructor(options) {
        this.name = options.name;
        this.flairCssClass = options.flairCssClass;
        this.flairText = options.flairText;
        this.isMod = options.isMod;
    }
}
exports.Author = Author;
function ruleFactory(config) {
    switch (config.kind) {
        case 'recentActivity':
            return new RecentActivityRule_1.RecentActivityRule(config);
        case 'repeatSubmission':
            return new RepeatSubmissionRule_1.default(config);
        default:
            throw new Error('rule "kind" was not recognized.');
    }
}
exports.ruleFactory = ruleFactory;
//# sourceMappingURL=index.js.map