import Action, {ActionJson, ActionOptions} from "./index";
import {Comment, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {renderContent} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, Footer, RequiredRichContent, RichContent, RuleResult} from "../Common/interfaces";
import {asComment, asSubmission, parseRedditThingsFromLink, truncateStringToLength} from "../util";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTarget, ActionTypes, ArbitraryActionTarget} from "../Common/Infrastructure/Atomic";
import {CMError} from "../Utils/Errors";
import {SnoowrapActivity} from "../Common/Infrastructure/Reddit";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";

export class CommentAction extends Action {
    content: string;
    lock: boolean = false;
    sticky: boolean = false;
    distinguish: boolean = false;
    footer?: false | string;
    targets: ArbitraryActionTarget[]

    constructor(options: CommentActionOptions) {
        super(options);
        const {
            content,
            lock = false,
            sticky = false,
            distinguish = false,
            footer,
            targets = ['self']
        } = options;
        this.footer = footer;
        this.content = content;
        this.lock = lock;
        this.sticky = sticky;
        this.distinguish = distinguish;
        if (!Array.isArray(targets)) {
            this.targets = [targets];
        } else {
            this.targets = targets;
        }
    }

    getKind(): ActionTypes {
        return 'comment';
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], actionResults: ActionResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
        const body =  await this.renderContent(this.content, item, ruleResults, actionResults) as string;

        const footer = await this.resources.renderFooter(item, this.footer);

        const renderedContent = `${body}${footer}`;
        this.logger.verbose(`Contents:\r\n${renderedContent.length > 100 ? `\r\n${renderedContent}` : renderedContent}`);

        let allErrors = true;
        const targetResults: string[] = [];
        const touchedEntities = [];

        for (const target of this.targets) {

            let targetItem = item;
            let targetIdentifier = target;

            if (target === 'parent') {
                if (asSubmission(item)) {
                    const noParent = `[Parent] Submission ${item.name} does not have a parent`;
                    this.logger.warn(noParent);
                    targetResults.push(noParent);
                    continue;
                }
                targetItem = await this.resources.getActivity(this.client.getSubmission(item.link_id));
            } else if (target !== 'self') {
                const redditThings = parseRedditThingsFromLink(target);
                let id = '';

                try {
                    if (redditThings.comment !== undefined) {
                        id = redditThings.comment.id;
                        targetIdentifier = `Permalink Comment ${id}`
                        // @ts-ignore
                        await this.resources.getActivity(this.client.getSubmission(redditThings.submission.id));
                        targetItem = await this.resources.getActivity(this.client.getComment(redditThings.comment.id));
                    } else if (redditThings.submission !== undefined) {
                        id = redditThings.submission.id;
                        targetIdentifier = `Permalink Submission ${id}`
                        targetItem = await this.resources.getActivity(this.client.getSubmission(redditThings.submission.id));
                    } else {
                        targetResults.push(`[Permalink] Could not parse ${target} as a reddit permalink`);
                        continue;
                    }
                } catch (err: any) {
                    targetResults.push(`[${targetIdentifier}] error occurred while fetching activity: ${err.message}`);
                    this.logger.warn(new CMError(`[${targetIdentifier}] error occurred while fetching activity`, {cause: err}));
                    continue;
                }
            }

            if (targetItem.archived) {
                const archived = `[${targetIdentifier}] Cannot comment because Item is archived`;
                this.logger.warn(archived);
                targetResults.push(archived);
                continue;
            }

            let modifiers = [];
            let reply: Comment;
            if (!dryRun) {
                // @ts-ignore
                reply = await targetItem.reply(renderedContent);
                // add to recent so we ignore activity when/if it is discovered by polling
                await this.resources.setRecentSelf(reply);
                touchedEntities.push(reply);
            }

            if (this.lock && targetItem.can_mod_post) {
                if (!targetItem.can_mod_post) {
                    this.logger.warn(`[${targetIdentifier}] Cannot lock because bot is not a moderator`);
                } else {
                    modifiers.push('Locked');
                    if (!dryRun) {
                        // snoopwrap typing issue, thinks comments can't be locked
                        // @ts-ignore
                        await reply.lock();
                    }
                }
            }

            if (this.distinguish) {
                if (!targetItem.can_mod_post) {
                    this.logger.warn(`[${targetIdentifier}] Cannot lock Distinguish/Sticky because bot is not a moderator`);
                } else {
                    modifiers.push('Distinguished');
                    if (this.sticky) {
                        modifiers.push('Stickied');
                    }
                    if (!dryRun) {
                        // @ts-ignore
                        await reply.distinguish({sticky: this.sticky});
                    }
                }
            }

            const modifierStr = modifiers.length === 0 ? '' : ` == ${modifiers.join(' | ')} == =>`;
            // @ts-ignore
            targetResults.push(`${targetIdentifier}${modifierStr} created Comment ${dryRun ? 'DRYRUN' : (reply as SnoowrapActivity).name}`)
            allErrors = false;
        }


        return {
            dryRun,
            success: !allErrors,
            result: `${targetResults.join('\n')}${truncateStringToLength(100)(body)}`,
            touchedEntities,
            data: {
                body,
                bodyShort: truncateStringToLength(100)(body),
                comments: targetResults,
                commentsFormatted: targetResults.map(x => `* ${x}`).join('\n')
            }
        };
    }

    protected getSpecificPremise(): object {
        return {
            content: this.content,
            lock: this.lock,
            sticky: this.sticky,
            distinguish: this.distinguish,
            footer: this.footer,
            targets: this.targets,
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

    /**
     * Specify where this comment should be made
     *
     * Valid values: 'self' | 'parent' | [reddit permalink]
     *
     * 'self' and 'parent' are special targets that are relative to the Activity being processed:
     * * When Activity is Submission => 'parent' does nothing
     * * When Activity is Comment
     *    * 'self' => reply to Activity
     *    * 'parent' => make a top-level comment in the Submission the Comment is in
     *
     * If target is not self/parent then CM assumes the value is a reddit permalink and will attempt to make a comment to that Activity
     * */
    targets?: ArbitraryActionTarget | ArbitraryActionTarget[]
}

export interface CommentActionOptions extends CommentActionConfig, ActionOptions {
}

/**
 * Reply to the Activity. For a submission the reply will be a top-level comment.
 * */
export interface CommentActionJson extends CommentActionConfig, ActionJson {
    kind: 'comment'
}
