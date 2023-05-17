import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import Snoowrap, {Comment, Submission} from "snoowrap";
import {renderContent} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, Footer, RuleResult} from "../Common/interfaces";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTypes} from "../Common/Infrastructure/Atomic";
import {truncateStringToLength} from "../util";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";

const truncate = truncateStringToLength(100);
const truncateLongMessage = truncateStringToLength(200);

const truncateIfNotUndefined = (val: string | undefined) => {
    if(val === undefined) {
        return undefined;
    }
    return truncate(val);
}

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

    getKind(): ActionTypes {
        return 'ban';
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], actionResults: ActionResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
        const renderedBody = await this.renderContent(this.message, item, ruleResults, actionResults);
        const renderedContent = renderedBody === undefined ? undefined : `${renderedBody}${await this.resources.renderFooter(item, this.footer)}`;

        const renderedReason = truncateIfNotUndefined(await this.renderContent(this.reason, item, ruleResults, actionResults) as string);
        const renderedNote = truncateIfNotUndefined(await this.renderContent(this.note, item, ruleResults, actionResults) as string);

        const touchedEntities = [];
        let banPieces = [];
        banPieces.push(`Message: ${renderedContent === undefined ? 'None' : `${renderedContent.length > 100 ? `\r\n${truncateLongMessage(renderedContent)}` : renderedContent}`}`);
        banPieces.push(`Reason:  ${renderedReason || 'None'}`);
        banPieces.push(`Note:    ${renderedNote || 'None'}`);
        const durText = this.duration === undefined ? 'permanently' : `for ${this.duration} days`;
        this.logger.info(`Banning ${item.author.name} ${durText}${this.reason !== undefined ? ` (${this.reason})` : ''}`);
        this.logger.verbose(`\r\n${banPieces.join('\r\n')}`);
        if (!dryRun) {
            // @ts-ignore
            const fetchedSub = await item.subreddit.fetch();
            const fetchedName = await item.author.name;
            const banData = {
                name: fetchedName,
                banMessage: renderedContent === undefined ? undefined : renderedContent,
                banReason: renderedReason,
                banNote: renderedNote,
                duration: this.duration
            };
            const bannedUser = await fetchedSub.banUser(banData);
            await this.resources.addUserToSubredditBannedUserCache(banData)
            touchedEntities.push(bannedUser);
        }
        return {
            dryRun,
            success: true,
            result: `Banned ${item.author.name} ${durText}${renderedReason !== undefined ? ` (${renderedReason})` : ''}`,
            touchedEntities,
            data: {
                message: renderedContent === undefined ? undefined : renderedContent,
                reason: renderedReason,
                note: renderedNote,
                duration: durText
            }
        };
    }

    protected getSpecificPremise(): object {
        return {
            message: this.message,
            duration: this.duration,
            reason: this.reason,
            note: this.note,
            footer: this.footer
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
     * Reason for ban. Can use Templating.
     *
     * If the length expands to more than 100 characters it will truncated with "..."
     *
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
     * A mod note for this ban. Can use Templating.
     *
     * If the length expands to more than 100 characters it will truncated with "..."
     *
     * @examples ["Sock puppet for u/AnotherUser"]
     * */
    note?: string
}

export interface BanActionOptions extends Omit<BanActionConfig, 'authorIs' | 'itemIs'>, ActionOptions {
}

/**
 * Ban the Author of the Activity this Check is run on
 * */
export interface BanActionJson extends BanActionConfig, ActionJson {
    kind: 'ban',
}

export default BanAction;
