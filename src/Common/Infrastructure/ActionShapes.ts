import {StructuredRunnableBase} from "./Runnable";
import {ActionJson} from "../types";

export type ActionObjectJson = Exclude<ActionJson, string>;
export type StructuredActionObjectJson = Omit<ActionObjectJson, 'authorIs' | 'itemIs'> & StructuredRunnableBase
