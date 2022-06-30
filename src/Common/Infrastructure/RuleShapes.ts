import {StructuredRunnableBase} from "./Runnable";
import {RuleSetConfigObject} from "../../Rule/RuleSet";
import {RuleObjectJsonTypes} from "../types";
import {IncludesData} from "./Includes";

export type RuleConfigData = RuleObjectJsonTypes | string | IncludesData;
export type RuleConfigHydratedData = Exclude<RuleConfigData, IncludesData>
export type RuleConfigObject = Exclude<RuleConfigHydratedData, string>
export type StructuredRuleConfigObject = Omit<RuleConfigObject, 'authorIs' | 'itemIs'> & StructuredRunnableBase
export type StructuredRuleSetConfigObject = Omit<RuleSetConfigObject, 'rules'> & {
    rules: StructuredRuleConfigObject[]
}
