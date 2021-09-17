import Action, {ActionJson, ActionOptions} from "./index";
import {Comment, ComposeMessageParams} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {renderContent} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, Footer, RequiredRichContent, RichContent} from "../Common/interfaces";
import {RuleResult} from "../Rule";
import {
    asSubmission,
    boolToString,
    isSubmission,
    parseRedditEntity,
    REDDIT_ENTITY_REGEX_URL,
    truncateStringToLength
} from "../util";
import SimpleError from "../Utils/SimpleError";

export class MessageAction extends Action {
    content: string;
    lock: boolean = false;
    sticky: boolean = false;
    distinguish: boolean = false;
    footer?: false | string;

    title?: string;
    to?: string;
    asSubreddit: boolean;

    constructor(options: MessageActionOptions) {
        super(options);
        const {
            content,
            asSubreddit,
            title,
            footer,
            to,
        } = options;
        this.to = to;
        this.footer = footer;
        this.content = content;
        this.asSubreddit = asSubreddit;
        this.title = title;
    }

    getKind() {
        return 'Message';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;
        const content = await this.resources.getContent(this.content);
        const body = await renderContent(content, item, ruleResults, this.resources.userNotes);

        const footer = await this.resources.generateFooter(item, this.footer);

        const renderedContent = `${body}${footer}`;

        let recipient = item.author.name;
        if(this.to !== undefined) {
            // parse to value
            try {
                const entityData = parseRedditEntity(this.to);
                if(entityData.type === 'user') {
                    recipient = entityData.name;
                } else {
                    recipient = `/r/${entityData.name}`;
                }
            } catch (err) {
                this.logger.error(`'to' field for message was not in a valid format. See ${REDDIT_ENTITY_REGEX_URL} for valid examples`);
                this.logger.error(err);
                err.logged = true;
                throw err;
            }
            if(recipient.includes('/r/') && this.asSubreddit) {
                throw new SimpleError(`Cannot send a message as a subreddit to another subreddit. Requested recipient: ${recipient}`);
            }
        }

        const msgOpts: ComposeMessageParams = {
            to: recipient,
            text: renderedContent,
            // @ts-ignore
            fromSubreddit: this.asSubreddit ? await item.subreddit.fetch() : undefined,
            subject: this.title || `Concerning your ${isSubmission(item) ? 'Submission' : 'Comment'}`,
        };

        const msgPreview = `\r\n
        TO: ${recipient}\r\n
        Subject: ${msgOpts.subject}\r\n
        Sent As Modmail: ${boolToString(this.asSubreddit)}\r\n\r\n
        ${renderedContent}`;

        this.logger.verbose(`Message Preview => \r\n ${msgPreview}`);

        if (!dryRun) {
            await this.client.composeMessage(msgOpts);
        }
        return {
            dryRun,
            success: true,
            result: truncateStringToLength(200)(msgPreview)
        }
    }
}

export interface MessageActionConfig extends RequiredRichContent, Footer {
    /**
     * Should this message be sent from modmail (as the subreddit) or as the bot user?
     * */
    asSubreddit: boolean

    /**
     * Entity to send message to.
     *
     * If not present Message be will sent to the Author of the Activity being checked.
     *
     * Valid formats:
     *
     * * `aUserName` -- send to /u/aUserName
     * * `u/aUserName` -- send to /u/aUserName
     * * `r/aSubreddit` -- sent to modmail of /r/aSubreddit
     *
     * **Note:** Reddit does not support sending a message AS a subreddit TO another subreddit
     *
     * @pattern ^\s*(\/[ru]\/|[ru]\/)*(\w+)*\s*$
     * @examples ["aUserName","u/aUserName","r/aSubreddit"]
     * */
    to?: string

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
