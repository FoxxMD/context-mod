import Action, {ActionJson, ActionOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {renderContent} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, Footer, RequiredRichContent, RichContent} from "../Common/interfaces";
import {RuleResult} from "../Rule";
import {truncateStringToLength} from "../util";

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

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;
        const content = await this.resources.getContent(this.content, item.subreddit);
        const body = await renderContent(content, item, ruleResults, this.resources.userNotes);

        const footer = await this.resources.generateFooter(item, this.footer);

        const renderedContent = `${body}${footer}`;
        this.logger.verbose(`Contents:\r\n${renderedContent.length > 100 ? `\r\n${renderedContent}` : renderedContent}`);

        if(item.archived) {
            this.logger.warn('Cannot comment because Item is archived');
            return {
                dryRun,
                success: false,
                result: 'Cannot comment because Item is archived'
            };
        }
        const touchedEntities = [];
        let reply: Comment;
        if(!dryRun) {
            // @ts-ignore
           reply = await item.reply(renderedContent);
           touchedEntities.push(reply);
        }
        if (this.lock) {
            if (!dryRun) {
                // snoopwrap typing issue, thinks comments can't be locked
                // @ts-ignore
                await item.lock();
                touchedEntities.push(item);
            }
        }
        if (this.distinguish && !dryRun) {
            // @ts-ignore
            await reply.distinguish({sticky: this.sticky});
        }
        let modifiers = [];
        if(this.distinguish) {
            modifiers.push('Distinguished');
        }
        if(this.sticky) {
            modifiers.push('Stickied');
        }
        const modifierStr = modifiers.length === 0 ? '' : `[${modifiers.join(' | ')}]`;
        return {
            dryRun,
            success: true,
            result: `${modifierStr}${this.lock ? ' - Locked Author\'s Activity - ' : ''}${truncateStringToLength(100)(body)}`,
            touchedEntities,
        };
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
