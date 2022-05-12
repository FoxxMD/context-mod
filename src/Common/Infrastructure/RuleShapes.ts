import {StructuredRunnableBase} from "./Runnable";
import {RuleSetObjectJson} from "../../Rule/RuleSet";
import {RuleObjectJsonTypes} from "../types";

export type RuleJson = RuleObjectJsonTypes | string;
export type RuleObjectJson = Exclude<RuleJson, string>
export type StructuredRuleObjectJson = Omit<RuleObjectJson, 'authorIs' | 'itemIs'> & StructuredRunnableBase
export type StructuredRuleSetObjectJson = Omit<RuleSetObjectJson, 'rules'> & {
    rules: StructuredRuleObjectJson[]
}
