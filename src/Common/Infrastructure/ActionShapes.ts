import {StructuredRunnableBase} from "./Runnable";
import {ActionJson} from "../types";
import {IncludesType} from "./Includes";

export type ActionConfigData = ActionJson;
export type ActionConfigHydratedData = Exclude<ActionConfigData, IncludesType>;
export type ActionConfigObject = Exclude<ActionConfigHydratedData, string>;
export type StructuredActionObjectJson = Omit<ActionConfigObject, 'authorIs' | 'itemIs'> & StructuredRunnableBase
