import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {RuleResult} from "../Rule";
import {renderContent} from "../Utils/SnoowrapUtils";
import {Footer} from "../Common/interfaces";

export class BanAction extends Action {

    message?: string;
    reason?: string;
    duration?: number;
    note?: string;
    footer?: false | string;

    constructor(options: BanActionOptions) {
        super(options);
        const {
            message,
            reason,
            duration,
            note,
            footer,
        } = options;
        this.footer = footer;
        this.message = message;
        this.reason = reason;
        this.duration = duration;
        this.note = note;
    }

    getKind() {
        return 'Ban';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<void> {
        const dryRun = runtimeDryrun || this.dryRun;
        const content = this.message === undefined ? undefined : await this.resources.getContent(this.message, item.subreddit);
        const renderedBody = content === undefined ? undefined : await renderContent(content, item, ruleResults, this.resources.userNotes);
        const renderedContent = renderedBody === undefined ? undefined : `${renderedBody}${await this.resources.generateFooter(item, this.footer)}`;

        let banPieces = [];
        banPieces.push(`Message: ${renderedContent === undefined ? 'None' : `${renderedContent.length > 100 ? `\r\n${renderedContent}` : renderedContent}`}`);
        banPieces.push(`Reason:  ${this.reason || 'None'}`);
        banPieces.push(`Note:    ${this.note || 'None'}`);
        const durText = this.duration === undefined ? 'permanently' : `for ${this.duration} days`;
        this.logger.info(`Banning ${item.author.name} ${durText}${this.reason !== undefined ? ` (${this.reason})` : ''}`);
        this.logger.verbose(`\r\n${banPieces.join('\r\n')}`);
        if (!dryRun) {
            // @ts-ignore
            const fetchedSub = await item.subreddit.fetch();
            const fetchedId = await item.author.id;
            await fetchedSub.banUser({
                name: fetchedId,
                banMessage: renderedContent === undefined ? undefined : renderedContent,
                banReason: this.reason,
                banNote: this.note,
                duration: this.duration
            });
        }
    }
}

export interface BanActionConfig extends ActionConfig, Footer {
    /**
     * The message that is sent in the ban notification. `message` is interpreted as reddit-flavored Markdown.
     *
     * If value starts with `wiki:` then the proceeding value will be used to get a wiki page
     *
     * EX `wiki:botconfig/mybot` tries to get `https://reddit.com/mySubredditExample/wiki/botconfig/mybot`
     *
     * EX `this is plain text` => "this is plain text"
     *
     * EX `this is **bold** markdown text` => "this is **bold** markdown text"
     *
     * @examples ["This is the content of a comment/report/usernote", "this is **bold** markdown text", "wiki:botconfig/acomment" ]
     * */
    message?: string
    /**
     * Reason for ban.
     * @maxLength 100
     * @examples ["repeat spam"]
     * */
    reason?: string
    /**
     * Number of days to ban the Author. If not specified Author will be banned permanently.
     * @minimum 1
     * @maximum 999
     * @examples [90]
     * */
    duration?: number
    /**
     * A mod note for this ban
     * @maxLength 100
     * @examples ["Sock puppet for u/AnotherUser"]
     * */
    note?: string
}

export interface BanActionOptions extends BanActionConfig, ActionOptions {
}

/**
 * Ban the Author of the Activity this Check is run on
 * */
export interface BanActionJson extends BanActionConfig, ActionJson {
    kind: 'ban',
}

export default BanAction;
