import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import {Comment} from "snoowrap";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RuleResult} from "../Rule";
import {UserNote, UserNoteJson} from "../Subreddit/UserNotes";
import Submission from "snoowrap/dist/objects/Submission";


export class UserNoteAction extends Action {
    content: string;
    type: string;
    allowDuplicate: boolean;

    constructor(options: UserNoteActionOptions) {
        super(options);
        const {type, content = '', allowDuplicate = false} = options;
        this.type = type;
        this.content = content;
        this.allowDuplicate = allowDuplicate;
    }

    getKind() {
        return 'User Note';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<void> {
        const dryRun = runtimeDryrun || this.dryRun;
        const content = await this.resources.getContent(this.content, item.subreddit);
        const renderedContent = await renderContent(content, item, ruleResults, this.resources.userNotes);
        this.logger.verbose(`Note:\r\n(${this.type}) ${renderedContent}`);

        if (!this.allowDuplicate) {
            const notes = await this.resources.userNotes.getUserNotes(item.author);
            const existingNote = notes.find((x) => x.link.includes(item.id));
            if (existingNote) {
                this.logger.info(`Will not add note because one already exists for this Activity (${existingNote.time.local().format()}) and allowDuplicate=false`);
                return;
            }
        }
        if (!dryRun) {
            await this.resources.userNotes.addUserNote(item, this.type, renderedContent);
        } else if (!await this.resources.userNotes.warningExists(this.type)) {
            this.logger.warn(`UserNote type '${this.type}' does not exist. If you meant to use this please add it through Toolbox first.`);
        }
    }
}

export interface UserNoteActionConfig extends ActionConfig,UserNoteJson {
    /**
     * Add Note even if a Note already exists for this Activity
     * @examples [false]
     * @default false
     * */
    allowDuplicate?: boolean,
}

export interface UserNoteActionOptions extends UserNoteActionConfig, ActionOptions {
}

/**
 * Add a Toolbox User Note to the Author of this Activity
 * */
export interface UserNoteActionJson extends UserNoteActionConfig, ActionJson {
    kind: 'usernote'
}
