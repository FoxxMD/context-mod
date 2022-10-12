import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {ActionProcessResult, RichContent} from "../Common/interfaces";
import {buildFilterCriteriaSummary, normalizeModActionCriteria, toModNoteLabel} from "../util";
import {RuleResultEntity} from "../Common/Entities/RuleResultEntity";
import {runCheckOptions} from "../Subreddit/Manager";
import {
    ActionTypes,
    ModUserNoteLabel,
} from "../Common/Infrastructure/Atomic";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";
import {ModNoteCriteria} from "../Common/Infrastructure/Filters/FilterCriteria";


export class ModNoteAction extends Action {
    content: string;
    type?: string;
    existingNoteCheck?: ModNoteCriteria
    referenceActivity: boolean

    constructor(options: ModNoteActionOptions) {
        super(options);
        const {type, content = '', existingNoteCheck = true, referenceActivity = true} = options;
        this.type = type;
        this.content = content;
        this.referenceActivity = referenceActivity;
        this.existingNoteCheck = typeof existingNoteCheck === 'boolean' ? this.generateModLogCriteriaFromDuplicateConvenience(existingNoteCheck) : normalizeModActionCriteria(existingNoteCheck);
    }

    getKind(): ActionTypes {
        return 'modnote';
    }

    protected getSpecificPremise(): object {
        return {
            content: this.content,
            type: this.type,
            existingNoteCheck: this.existingNoteCheck,
            referenceActivity: this.referenceActivity,
        }
    }

    async process(item: Comment | Submission, ruleResults: RuleResultEntity[], actionResults: ActionResultEntity[], options: runCheckOptions): Promise<ActionProcessResult> {
        const dryRun = this.getRuntimeAwareDryrun(options);

        const modLabel = this.type !== undefined ? toModNoteLabel(this.type) : undefined;

        const renderedContent = await this.renderContent(this.content, item, ruleResults, actionResults);
        this.logger.verbose(`Note:\r\n(${this.type}) ${renderedContent}`);

        let noteCheckPassed: boolean = true;
        let noteCheckResult: undefined | string;

        if(this.existingNoteCheck === undefined) {
            // nothing to do!
            noteCheckResult = 'existingNoteCheck=false so no existing note checks were performed.';
        } else {
            const noteCheckCriteriaResult = await this.resources.isAuthor(item, {
                modActions: [this.existingNoteCheck]
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
            await this.resources.addModNote({
                label: modLabel,
                note: renderedContent,
                activity: this.referenceActivity ? item : undefined,
                subreddit: this.resources.subreddit,
                user: item.author
            });
        }
        return {
            success: true,
            dryRun,
            result: `${modLabel !== undefined ? `(${modLabel})` : ''} ${renderedContent}`
        }
    }

    generateModLogCriteriaFromDuplicateConvenience(val: boolean): ModNoteCriteria | undefined {
        if(val) {
            return {
                noteType: this.type !== undefined ? [toModNoteLabel(this.type)] : undefined,
                note: this.content !== '' ? [this.content] : undefined,
                referencesCurrentActivity: this.referenceActivity ? true : undefined,
                search: 'current',
                count: '< 1'
            }
        }
        return undefined;
    }
}

export interface ModNoteActionConfig extends ActionConfig, RichContent {
    /**
     * Check if there is an existing Note matching some criteria before adding the Note.
     *
     * If this check passes then the Note is added. The value may be a boolean or ModNoteCriteria.
     *
     * Boolean convenience:
     *
     * * If `true` or undefined then CM generates a ModNoteCriteria that passes only if there is NO existing note matching note criteria
     * * If `false` then no check is performed and Note is always added
     *
     * @examples [true]
     * @default true
     * */
    existingNoteCheck?: boolean | ModNoteCriteria,
    type?: ModUserNoteLabel
    referenceActivity?: boolean
}

export interface ModNoteActionOptions extends Omit<ModNoteActionConfig, 'authorIs' | 'itemIs'>, ActionOptions {
}

/**
 * Add a Toolbox User Note to the Author of this Activity
 * */
export interface ModNoteActionJson extends ModNoteActionConfig, ActionJson {
    kind: 'modnote'
}
