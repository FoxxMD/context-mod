import Action, {ActionJson, ActionOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RequiredRichContent, RichContent} from "../Common/interfaces";
import {RuleResult} from "../Rule";
import {generateFooter} from "../util";

export class CommentAction extends Action {
    content: string;
    lock: boolean = false;
    sticky: boolean = false;
    distinguish: boolean = false;

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

    getKind() {
        return 'Comment';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        const content = await this.resources.getContent(this.content, item.subreddit);
        const body = await renderContent(content, item, ruleResults, this.resources.userNotes);
        this.logger.verbose(`Contents:\r\n${body}`);

        if(item.archived) {
            this.logger.warn('Cannot comment because Item is archived');
            return;
        }

        const footer = await generateFooter(item);

        const renderedContent = `${body}${footer}`;
        // @ts-ignore
        const reply: Comment = await item.reply(renderedContent);
        if (this.lock) {
            if (!this.dryRun) {
                // snoopwrap typing issue, thinks comments can't be locked
                // @ts-ignore
                await item.lock();
            }
        }
        if (this.distinguish && !this.dryRun) {
            // @ts-ignore
            await reply.distinguish({sticky: this.sticky});
        }
    }
}

export interface CommentActionConfig extends RequiredRichContent {
    /**
     * Lock the comment after creation?
     * */
    lock?: boolean,
    /**
     * Stick the comment after creation?
     * */
    sticky?: boolean,
    /**
     * Distinguish the comment after creation?
     * */
    distinguish?: boolean,
}

export interface CommentActionOptions extends CommentActionConfig, ActionOptions {
}

/**
 * Reply to the Activity. For a submission the reply will be a top-level comment.
 * */
export interface CommentActionJson extends CommentActionConfig, ActionJson {
kind: 'comment'
}
