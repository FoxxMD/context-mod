import Action, {ActionJson, ActionOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {renderContent} from "../Utils/SnoowrapUtils";
import {Footer, RequiredRichContent, RichContent} from "../Common/interfaces";
import {RuleResult} from "../Rule";

export class CommentAction extends Action {
    content: string;
    lock: boolean = false;
    sticky: boolean = false;
    distinguish: boolean = false;
    footer?: false | string;

    constructor(options: CommentActionOptions) {
        super(options);
        const {
            content,
            lock = false,
            sticky = false,
            distinguish = false,
            footer,
        } = options;
        this.footer = footer;
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

        const footer = await this.resources.generateFooter(item, this.footer);

        const renderedContent = `${body}${footer}`;
        this.logger.verbose(`Contents:\r\n${renderedContent.length > 100 ? `\r\n${renderedContent}` : renderedContent}`);

        if(item.archived) {
            this.logger.warn('Cannot comment because Item is archived');
            return;
        }
        let reply: Comment;
        if(!this.dryRun) {
            // @ts-ignore
           reply = await item.reply(renderedContent);
        }
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

export interface CommentActionConfig extends RequiredRichContent, Footer {
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
