import {Check, CheckStructuredJson} from "../Check";
import {ActivityCheckJson, FilterCriteriaDefaults, PostBehavior, PostBehaviorTypes} from "../Common/interfaces";
import {SubmissionCheck} from "../Check/SubmissionCheck";
import {CommentCheck} from "../Check/CommentCheck";
import {Logger} from "winston";
import {mergeArr} from "../util";
import {SubredditResources} from "../Subreddit/SubredditResources";
import {ExtendedSnoowrap} from "../Utils/SnoowrapClients";

export class Run {
    name: string;
    submissionChecks: SubmissionCheck[] = [];
    commentChecks: CommentCheck[] = [];
    postFail?: PostBehaviorTypes;
    postTrigger?: PostBehaviorTypes;
    filterCriteriaDefaults?: FilterCriteriaDefaults
    logger: Logger;
    client: ExtendedSnoowrap;
    subreddtName: string;
    resources: SubredditResources;
    dryRun?: boolean;

    constructor(options: RunOptions) {
        const {
            name,
            checks = [],

            postFail,
            postTrigger,
            filterCriteriaDefaults,
            logger,
            resources,
            client,
            subredditName,
            dryRun,
        } = options;
        this.name = name;
        this.logger = logger.child({labels: [`RUN ${name}`]}, mergeArr);
        this.resources = resources;
        this.client = client;
        this.subreddtName = subredditName;
        this.postFail = postFail;
        this.postTrigger = postTrigger;
        this.filterCriteriaDefaults = filterCriteriaDefaults;
        this.dryRun = dryRun;

        for(const c of checks) {
            const checkConfig = {
                ...c,
                dryRun: this.dryRun || c.dryRun,
                logger: this.logger,
                subredditName: this.subreddtName,
                resources: this.resources,
                client: this.client,
            };
            if (c.kind === 'comment') {
                this.commentChecks.push(new CommentCheck(checkConfig));
            } else if (c.kind === 'submission') {
                this.submissionChecks.push(new SubmissionCheck(checkConfig));
            }
        }
    }
}

export interface IRun extends PostBehavior {
    /**
     * Friendly name for this Run EX "flairsRun"
     *
     * Can only contain letters, numbers, underscore, spaces, and dashes
     *
     * @pattern ^[a-zA-Z]([\w -]*[\w])?$
     * @examples ["myNewRun"]
     * */
    name?: string
    /**
     * Set the default filter criteria for all checks. If this property is specified it will override any defaults passed from the bot's config
     *
     * Default behavior is to exclude all mods and automoderator from checks
     * */
    filterCriteriaDefaults?: FilterCriteriaDefaults

    /**
     * Use this option to override the `dryRun` setting for all Actions of all Checks in this Run
     *
     * @examples [false, true]
     * */
    dryRun?: boolean;
}

export interface RunOptions extends IRun {
    // submissionChecks?: SubmissionCheck[]
    // commentChecks?: CommentCheck[]
    checks: CheckStructuredJson[]
    name: string
    logger: Logger
    resources: SubredditResources
    client: ExtendedSnoowrap
    subredditName: string;
}

export interface RunJson extends IRun {
    checks: ActivityCheckJson[]
}

export interface RunStructuredJson extends RunJson {
    checks: CheckStructuredJson[]
}
