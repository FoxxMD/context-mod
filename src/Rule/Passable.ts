import {Comment, Submission} from "snoowrap";
import {Rule} from "./index";

export interface Passable {
    passes(item: Comment | Submission): Promise<[boolean, Rule[]]>;
}
