import {ActionJson, ActionConfig, ActionOptions} from "./index";
import Action from "./index";
import {Comment} from "snoowrap";
import {renderContent} from "../Utils/SnoowrapUtils";
import {RuleResult} from "../Rule";
import Submission from "snoowrap/dist/objects/Submission";
import {ActionProcessResult, RichContent} from "../Common/interfaces";
import {ModNoteLabel} from "../Common/types";
import {toModNoteLabel} from "../util";


export class ModNoteAction extends Action {
    content: string;
    type?: string;
    allowDuplicate: boolean;
    referenceActivity: boolean

    constructor(options: ModNoteActionOptions) {
        super(options);
        const {type, content = '', allowDuplicate = false, referenceActivity = true} = options;
        this.type = type;
        this.content = content;
        this.allowDuplicate = allowDuplicate;
        this.referenceActivity = referenceActivity;
    }

    getKind() {
        return 'Mod Note';
    }

    async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
        const dryRun = runtimeDryrun || this.dryRun;

        const modLabel = this.type !== undefined ? toModNoteLabel(this.type) : undefined;

        const content = await this.resources.getContent(this.content, item.subreddit);
        const renderedContent = await renderContent(content, item, ruleResults, this.resources.userNotes);
        this.logger.verbose(`Note:\r\n(${this.type}) ${renderedContent}`);

        // TODO see what changes are made for bulk fetch of notes before implementing this
        // https://www.reddit.com/r/redditdev/comments/t8w861/new_mod_notes_api/
        // if (!this.allowDuplicate) {
        //     const notes = await this.resources.userNotes.getUserNotes(item.author);
        //     let existingNote = notes.find((x) => x.link !== null && x.link.includes(item.id));
        //     if(existingNote === undefined && notes.length > 0) {
        //         const lastNote = notes[notes.length - 1];
        //         // possibly notes don't have a reference link so check if last one has same text
        //         if(lastNote.link === null && lastNote.text === renderedContent) {
        //             existingNote = lastNote;
        //         }
        //     }
        //     if (existingNote !== undefined && existingNote.noteType === this.type) {
        //         this.logger.info(`Will not add note because one already exists for this Activity (${existingNote.time.local().format()}) and allowDuplicate=false`);
        //         return {
        //             dryRun,
        //             success: false,
        //             result: `Will not add note because one already exists for this Activity (${existingNote.time.local().format()}) and allowDuplicate=false`
        //         };
        //     }
        // }
        if (!dryRun) {
            await this.client.addModNote({
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
}

export interface ModNoteActionConfig extends ActionConfig, RichContent {
    /**
     * Add Note even if a Note already exists for this Activity
     * @examples [false]
     * @default false
     * */
    allowDuplicate?: boolean,
    type?: ModNoteLabel
    referenceActivity?: boolean
}

export interface ModNoteActionOptions extends ModNoteActionConfig, ActionOptions {
}

/**
 * Add a Toolbox User Note to the Author of this Activity
 * */
export interface ModNoteActionJson extends ModNoteActionConfig, ActionJson {
    kind: 'modnote'
}
