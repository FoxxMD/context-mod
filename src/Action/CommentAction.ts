import Action, {ActionJSONConfig, ActionConfig} from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";

export class CommentAction extends Action {
    content: string;
    lock: boolean = false;
    sticky: boolean = false;
    distinguish: boolean = false;
    name?: string = 'Comment';

    constructor(options: CommentActionOptions) {
        super(options);
        const {
            content,
            lock = false,
            sticky = false,
            distinguish = false,
        } = options;
        this.content = content;
        this.lock = lock;
        this.sticky = sticky;
        this.distinguish = distinguish;
    }

    async handle(item: Comment|Submission, client: Snoowrap): Promise<void> {
    }
}

export interface CommentActionOptions extends ActionConfig {
    content: string,
    lock?: boolean,
    sticky?: boolean,
    distinguish?: boolean,
}

export interface CommentActionJSONConfig extends CommentActionOptions, ActionJSONConfig {

}
