import Action, {ActionJSONConfig, ActionConfig, ActionOptions} from "./index";
import Snoowrap, {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";

export const WIKI_DESCRIM = 'wiki:';

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

    async handle(item: Comment | Submission, client: Snoowrap): Promise<void> {
        let rawContent: string = this.content;
        if (this.content.trim().substring(0, WIKI_DESCRIM.length - 1) === WIKI_DESCRIM) {
            // get wiki content
            const wikiPageName = this.content.trim().substring(WIKI_DESCRIM.length - 1);
            try {
                const wiki = item.subreddit.getWikiPage(wikiPageName);
                rawContent = await wiki.content_md;
            } catch (err) {
                this.logger.error(err);
                throw new Error(`Could not read wiki page. Please ensure the page '${wikiPageName}' exists and is readable`);
            }
        }
        // @ts-ignore
        const reply: Comment = await item.reply(rawContent);
        if (this.lock && item instanceof Submission) {
            // @ts-ignore
            await item.lock();
        }
        if (this.distinguish) {
            // @ts-ignore
            await reply.distinguish({sticky: this.sticky});
        }
    }
}

export interface CommentActionOptions extends ActionOptions {
    content: string,
    lock?: boolean,
    sticky?: boolean,
    distinguish?: boolean,
}

export interface CommentActionJSONConfig extends CommentActionOptions, ActionJSONConfig {

}
