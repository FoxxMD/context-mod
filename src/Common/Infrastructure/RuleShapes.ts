import {StructuredRunnableBase} from "./Runnable";
import {RuleSetConfigObject} from "../../Rule/RuleSet";
import {RuleObjectJsonTypes} from "../types";
import {IncludesType} from "./Includes";

export type RuleConfigData = RuleObjectJsonTypes | string | IncludesType;
export type RuleConfigHydratedData = Exclude<RuleConfigData, IncludesType>
export type RuleConfigObject = Exclude<RuleConfigHydratedData, string>
export type StructuredRuleConfigObject = Omit<RuleConfigObject, 'authorIs' | 'itemIs'> & StructuredRunnableBase
export type StructuredRuleSetConfigObject = Omit<RuleSetConfigObject, 'rules'> & {
    rules: StructuredRuleConfigObject[]
}
