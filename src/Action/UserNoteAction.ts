import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import {Comment} from "snoowrap";
import {UserNoteJson} from "../Subreddit/UserNotes";
import Submission from "snoowrap/dist/objects/Submission";
import {ActionProcessResult, RuleResult} from "../Common/interfaces";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {ActionTypes, UserNoteType} from "../Common/Infrastructure/Atomic";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";
import {
    FullUserNoteCriteria,
    toFullUserNoteCriteria, UserNoteCriteria
} from "../Common/Infrastructure/Filters/FilterCriteria";
import {buildFilterCriteriaSummary} from "../util";


export class UserNoteAction extends Action {
    content: string;
    type: UserNoteType;
    existingNoteCheck?: UserNoteCriteria

    constructor(options: UserNoteActionOptions) {
        super(options);
        const {type, content = '', existingNoteCheck = true, allowDuplicate} = options;
        this.type = type;
        this.content = content;
        if(typeof existingNoteCheck !== 'boolean') {
            this.existingNoteCheck = existingNoteCheck;
        } else {
            let exNotecheck: boolean;
            if(allowDuplicate !== undefined) {
                exNotecheck = !allowDuplicate;
            } else {
                exNotecheck = existingNoteCheck;
            }
            this.existingNoteCheck = this.generateCriteriaFromDuplicateConvenience(exNotecheck);
        }
    }

    getKind(): ActionTypes {
        return 'usernote';
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], actionResults: ActionResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);
        const renderedContent = (await this.renderContent(this.content, item, ruleResults, actionResults) as string);
        this.logger.verbose(`Note:\r\n(${this.type}) ${renderedContent}`);

        let noteCheckPassed: boolean = true;
        let noteCheckResult: undefined | string;

        if(this.existingNoteCheck === undefined) {
            // nothing to do!
            noteCheckResult = 'existingNoteCheck=false so no existing note checks were performed.';
        } else {
            const noteCheckCriteriaResult = await this.resources.isAuthor(item, {
                userNotes: [this.existingNoteCheck]
            });
            noteCheckPassed = noteCheckCriteriaResult.passed;
            const {details} = buildFilterCriteriaSummary(noteCheckCriteriaResult);
            noteCheckResult = `${noteCheckPassed ? 'Existing note check condition succeeded' : 'Will not add note because existing note check condition failed'} -- ${details.join(' ')}`;
        }

        this.logger.info(noteCheckResult);
        if (!noteCheckPassed) {
            return {
                dryRun,
                success: false,
                result: noteCheckResult
            };
        }

        if (!dryRun) {
            await this.resources.userNotes.addUserNote(item, this.type, renderedContent, this.name !== undefined ? `(Action ${this.name})` : '');
        } else if (!await this.resources.userNotes.warningExists(this.type)) {
            this.logger.warn(`UserNote type '${this.type}' does not exist. If you meant to use this please add it through Toolbox first.`);
        }
        return {
            success: true,
            dryRun,
            result: `(${this.type}) ${renderedContent}`
        }
    }

    generateCriteriaFromDuplicateConvenience(val: boolean): UserNoteCriteria | undefined {
        if(val) {
            return {
                type: this.type,
                note: this.content !== '' && this.content !== undefined && this.content !== null ? [this.content] : undefined,
                search: 'current',
                count: '< 1'
            };
        }
        return undefined;
    }

    protected getSpecificPremise(): object {
        return {
            content: this.content,
            type: this.type,
            existingNoteCheck: this.existingNoteCheck
        }
    }
}

export interface UserNoteActionConfig extends ActionConfig,UserNoteJson {
    /**
     * Add Note even if a Note already exists for this Activity
     *
     * USE `existingNoteCheck` INSTEAD
     *
     * @examples [false]
     * @default false
     * @deprecated
     * */
    allowDuplicate?: boolean,

    /**
     * Check if there is an existing Note matching some criteria before adding the Note.
     *
     * If this check passes then the Note is added. The value may be a boolean or UserNoteCriteria.
     *
     * Boolean convenience:
     *
     * * If `true` or undefined then CM generates a UserNoteCriteria that passes only if there is NO existing note matching note criteria
     * * If `false` then no check is performed and Note is always added
     *
     * @examples [true]
     * @default true
     * */
    existingNoteCheck?: boolean | UserNoteCriteria,
}

export interface UserNoteActionOptions extends Omit<UserNoteActionConfig, 'authorIs' | 'itemIs'>, ActionOptions {
}

/**
 * Add a Toolbox User Note to the Author of this Activity
 * */
export interface UserNoteActionJson extends UserNoteActionConfig, ActionJson {
    kind: 'usernote'
}
