import Action, {ActionJson, ActionOptions} from "./index";
import {Comment, SubmitLinkOptions, SubmitSelfPostOptions, VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {renderContent} from "../Utils/SnoowrapUtils";
import {ActionProcessResult, Footer, RequiredRichContent, RichContent, RuleResult} from "../Common/interfaces";
import {asComment, asSubmission, parseRedditEntity, parseRedditThingsFromLink, sleep, truncateStringToLength} from "../util";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTarget, ActionTypes, ArbitraryActionTarget} from "../Common/Infrastructure/Atomic";
import {CMError} from "../Utils/Errors";
import {SnoowrapActivity} from "../Common/Infrastructure/Reddit";
import Subreddit from "snoowrap/dist/objects/Subreddit";

export class SubmissionAction extends Action {
    content?: string;
    lock: boolean = false;
    sticky: boolean = false;
    distinguish: boolean = false;
    spoiler: boolean = false;
    nsfw: boolean = false;
    flairId?: string
    flairText?: string
    url?: string
    title: string
    footer?: false | string;
    targets: ('self' | string)[]

    constructor(options: SubmissionActionOptions) {
        super(options);
        const {
            content,
            lock = false,
            sticky = false,
            spoiler = false,
            distinguish = false,
            nsfw = false,
            flairText,
            flairId,
            footer,
            url,
            title,
            targets = ['self']
        } = options;
        this.footer = footer;
        this.content = content;
        this.lock = lock;
        this.sticky = sticky;
        if(this.sticky) {
            this.distinguish = sticky;
        } else {
            this.distinguish = distinguish;
        }
        this.spoiler = spoiler;
        this.nsfw = nsfw;
        this.flairText = flairText;
        this.flairId = flairId;
        this.url = url;
        this.title = title;
        if (!Array.isArray(targets)) {
            this.targets = [targets];
        } else {
            this.targets = targets;
        }
    }

    getKind(): ActionTypes {
        return 'submission';
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);

        const title = await this.renderContent(this.title, item, ruleResults) as string;
        this.logger.verbose(`Title: ${title}`);

        const url = await this.renderContent(this.url, item, ruleResults);

        this.logger.verbose(`URL: ${url !== undefined ? url : '[No URL]'}`);

        const body = await this.renderContent(this.content, item, ruleResults);

        let renderedContent: string | undefined = undefined;
        if(body !== undefined) {
            const footer = await this.resources.renderFooter(item, this.footer);
            renderedContent = `${body}${footer}`;
            this.logger.verbose(`Contents:\r\n${renderedContent.length > 100 ? `\r\n${renderedContent}` : renderedContent}`);
        } else {
           this.logger.verbose(`Contents: [No Body]`);
        }


        let allErrors = true;
        const targetResults: string[] = [];
        const touchedEntities = [];

        let submittedOnce = false;

        for (const targetVal of this.targets) {

            //
            if(submittedOnce) {
                // delay submissions by 3 seconds (on previous successful call)
                // to try to spread out load
                await sleep(3000);
            }

            let target: Subreddit = item.subreddit;
            let targetIdentifier = targetVal;

            if (targetVal !== 'self') {
                const subredditVal = parseRedditEntity(targetVal);

                try {
                    target = await this.resources.getSubreddit(subredditVal.name);
                    targetIdentifier = `[Subreddit ${target.display_name}]`;
                } catch (err: any) {
                    targetResults.push(`[${targetIdentifier}] error occurred while fetching subreddit: ${err.message}`);
                    if(!err.logged) {
                        this.logger.warn(new CMError(`[${targetIdentifier}] error occurred while fetching subreddit`, {cause: err}));
                    }
                    continue;
                }
            }

            // TODO check if we can post in subreddit

            let modifiers = [];
            let post: Submission | undefined;
            if (!dryRun) {
                let opts: SubmitLinkOptions | SubmitSelfPostOptions;
                let type: 'self' | 'link';
                const genericOpts = {
                    title,
                    subredditName: target.display_name,
                    nsfw: this.nsfw,
                    spoiler: this.spoiler,
                    flairId: this.flairId,
                    flairText: this.flairText,
                };
                if(url !== undefined) {
                    type = 'link';
                    opts = {
                        ...genericOpts,
                        url,
                    };
                    if(renderedContent !== undefined) {
                        // @ts-ignore
                        linkOpts.text = renderedContent;
                    }
                } else {
                    type = 'self';
                    opts = {
                        ...genericOpts,
                        text: renderedContent,
                    }
                }
                // @ts-ignore
                post = await this.tryPost(type, target, opts);
                await this.resources.setRecentSelf(post as Submission);
                if(post !== undefined)  {
                    touchedEntities.push(post);
                }
            }

            if (this.lock) {
                if (post !== undefined && !post.can_mod_post) {
                    this.logger.warn(`[${targetIdentifier}] Cannot lock because bot is not a moderator`);
                } else {
                    modifiers.push('Locked');
                    if (!dryRun && post !== undefined) {
                        // snoopwrap typing issue, thinks comments can't be locked
                        // @ts-ignore
                        await post.lock();
                    }
                }
            }

            if (this.distinguish) {
                if (post !== undefined && !post.can_mod_post) {
                    this.logger.warn(`[${targetIdentifier}] Cannot Distinguish/Sticky because bot is not a moderator`);
                } else {
                    modifiers.push('Distinguished');
                    if (this.sticky) {
                        modifiers.push('Stickied');
                    }
                    if (!dryRun && post !== undefined) {
                        // @ts-ignore
                        await post.distinguish({sticky: this.sticky});
                    }
                }
            }

            const modifierStr = modifiers.length === 0 ? '' : ` == ${modifiers.join(' | ')} == =>`;
            const targetSummary = `${targetIdentifier} ${modifierStr} created Submission ${dryRun ? 'DRYRUN' : (post as SnoowrapActivity).name}`;
            // @ts-ignore
            targetResults.push(targetSummary)
            this.logger.verbose(targetSummary);
            allErrors = false;
        }


        return {
            dryRun,
            success: !allErrors,
            result: `${targetResults.join('\n')}${this.url !== undefined ? `\nURL: ${this.url}` : ''}${body !== undefined ? truncateStringToLength(100)(body) : ''}`,
            touchedEntities,
        };
    }

    // @ts-ignore
    protected async tryPost(type: 'self' | 'link', target: Subreddit, data: SubmitLinkOptions | SubmitSelfPostOptions, maxAttempts = 2): Promise<Submission> {
        let post: Submission | undefined;
        let error: any;
        for (let i = 0; i <= maxAttempts; i++) {
            try {
                if (type === 'self') {
                    // @ts-ignore
                    post = await target.submitSelfpost(data as SubmitSelfPostOptions);
                } else {
                    // @ts-ignore
                    post = await target.submitLink(data as SubmitLinkOptions);
                }
                break;
            } catch (e: any) {
                if (e.message.includes('RATELIMIT')) {
                    // Looks like you've been doing that a lot. Take a break for 5 seconds before trying again
                    await sleep(5000);
                    error = e;
                } else {
                    throw e;
                }
            }
        }
        if (error !== undefined) {
            throw error;
        }
        // @ts-ignore
        return post;
    }

    protected getSpecificPremise(): object {
        return {
            content: this.content,
            lock: this.lock,
            sticky: this.sticky,
            spoiler: this.spoiler,
            distinguish: this.distinguish,
            nsfw: this.nsfw,
            flairId: this.flairId,
            flairText: this.flairText,
            url: this.url,
            text: this.content !== undefined ? truncateStringToLength(50)(this.content) : undefined,
            footer: this.footer,
            targets: this.targets,
        }
    }
}

export interface SubmissionActionConfig extends RichContent, Footer {
    /**
     * Lock the Submission after creation?
     * */
    lock?: boolean,
    /**
     * Sticky the Submission after creation?
     * */
    sticky?: boolean,

    nsfw?: boolean

    spoiler?: boolean

    /**
     * The title of this Submission.
     *
     * Templated the same as **content**
     * */
    title: string

    /**
     * If Submission should be a Link, the URL to use
     *
     * Templated the same as **content**
     *
     * PROTIP: To make a Link Submission pointing to the Activity being processed use `{{item.permalink}}` as the URL value
     * */
    url?: string

    /**
     * Flair template to apply to this Submission
     * */
    flairId?: string

    /**
     * Flair text to apply to this Submission
     * */
    flairText?: string

    /**
     * Distinguish as Mod after creation?
     * */
    distinguish?: boolean

    /**
     * Specify where this Submission should be made
     *
     * Valid values: 'self' | [subreddit]
     *
     * * 'self' -- DEFAULT. Post Submission to same subreddit of Activity being processed
     * * [subreddit] -- The name of a subreddit to post Submission to. EX mealtimevideos
     * */
    targets?: 'self' | string
}

export interface SubmissionActionOptions extends SubmissionActionConfig, ActionOptions {
}

/**
 * Reply to the Activity. For a submission the reply will be a top-level comment.
 * */
export interface SubmissionActionJson extends SubmissionActionConfig, ActionJson {
    kind: 'submission'
}
