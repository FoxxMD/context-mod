import Action, {ActionJson, ActionOptions} from "./index";
import {Comment, ComposeMessageParams} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {renderContent, singleton} from "../Utils/SnoowrapUtils";
import {Footer, RequiredRichContent, RichContent} from "../Common/interfaces";
import {RuleResult} from "../Rule";
import {boolToString} from "../util";

export class MessageAction extends Action {
    content: string;
    lock: boolean = false;
    sticky: boolean = false;
    distinguish: boolean = false;
    footer?: false | string;

    title?: string;
    asSubreddit: boolean;

    constructor(options: MessageActionOptions) {
        super(options);
        const {
            content,
            asSubreddit,
            title,
            footer,
        } = options;
        this.footer = footer;
        this.content = content;
        this.asSubreddit = asSubreddit;
        this.title = title;
    }

    getKind() {
        return 'Message';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<void> {
        const dryRun = runtimeDryrun || this.dryRun;
        const content = await this.resources.getContent(this.content);
        const body = await renderContent(content, item, ruleResults, this.resources.userNotes);

        const footer = await this.resources.generateFooter(item, this.footer);

        const renderedContent = `${body}${footer}`;
        // @ts-ignore
        const author = await item.author.fetch() as RedditUser;

        const client = singleton.getClient();

        const msgOpts: ComposeMessageParams = {
            to: author,
            text: renderedContent,
            // @ts-ignore
            fromSubreddit: this.asSubreddit ? await item.subreddit.fetch() : undefined,
            subject: this.title || `Concerning your ${item instanceof Submission ? 'Submission' : 'Comment'}`,
        };

        const msgPreview = `\r\n
        TO: ${author.name}\r\n
        Subject: ${msgOpts.subject}\r\n
        Sent As Modmail: ${boolToString(this.asSubreddit)}\r\n\r\n
        ${renderedContent}`;

        this.logger.verbose(`Message Preview => \r\n ${msgPreview}`);

        if (!dryRun) {
            await client.composeMessage(msgOpts);
        }
    }
}

export interface MessageActionConfig extends RequiredRichContent, Footer {
    /**
     * Should this message be sent from modmail (as the subreddit) or as the bot user?
     * */
    asSubreddit: boolean

    /**
     * The title of the message
     *
     * If not specified will be defaulted to `Concerning your [Submission/Comment]`
     * */
    title?: string
}

export interface MessageActionOptions extends MessageActionConfig, ActionOptions {
}

/**
 * Send a private message to the Author of the Activity.
 * */
export interface MessageActionJson extends MessageActionConfig, ActionJson {
    kind: 'message'
}