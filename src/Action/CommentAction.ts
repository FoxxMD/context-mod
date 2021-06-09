import Action, {ActionJson, ActionOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import dayjs, {Dayjs} from "dayjs";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RichContent} from "../Common/interfaces";
import {RuleResult} from "../Rule";
import LoggedError from "../Utils/LoggedError";

export const WIKI_DESCRIM = 'wiki:';

export class CommentAction extends Action {
    content: string;
    hasWiki: boolean;
    wiki?: string;
    wikiFetched?: Dayjs;
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
        this.hasWiki = content.trim().substring(0, WIKI_DESCRIM.length) === WIKI_DESCRIM;
        this.content = content;
        if (this.hasWiki) {
            this.wiki = this.content.trim().substring(WIKI_DESCRIM.length);
        }
        this.lock = lock;
        this.sticky = sticky;
        this.distinguish = distinguish;
    }

    getKind() {
        return 'Comment';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[]): Promise<void> {
        if (this.hasWiki && (this.wikiFetched === undefined || Math.abs(dayjs().diff(this.wikiFetched, 'minute')) > 5)) {
            try {
                const wiki = item.subreddit.getWikiPage(this.wiki as string);
                this.content = await wiki.content_md;
                this.wikiFetched = dayjs();
            } catch (err) {
                this.logger.error(`Could not read wiki page. Please ensure the page '${this.wiki}' exists and is readable`, err);
                throw new LoggedError(`Could not read wiki page. Please ensure the page '${this.wiki}' exists and is readable`);
            }
        }
        // @ts-ignore
        const reply: Comment = await item.reply(renderContent(this.content, item, ruleResults));
        if (this.lock) {
            if(item instanceof Submission) {
                // @ts-ignore
                await item.lock();
            } else {
                this.logger.warn('Snoowrap does not support locking Comments');
            }
        }
        if (this.distinguish) {
            // @ts-ignore
            await reply.distinguish({sticky: this.sticky});
        }
    }
}

export interface CommentActionConfig extends RichContent {
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

export interface CommentActionOptions extends CommentActionConfig,ActionOptions {
}

/**
 * Reply to the Activity. For a submission the reply will be a top-level comment.
 * */
export interface CommentActionJson extends CommentActionConfig, ActionJson {

}
