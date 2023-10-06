import {ModAction, ModActionRaw} from "./ModAction";
import {Submission, RedditUser, Comment, Subreddit} from "snoowrap/dist/objects"
import {ModUserNote, ModUserNoteRaw} from "./ModUserNote";
//import {ExtendedSnoowrap} from "../../Utils/SnoowrapClients";
import dayjs, {Dayjs} from "dayjs";
import {
    asComment,
    asSubmission,
    generateSnoowrapEntityFromRedditThing,
    isComment,
    isSubmission,
    parseRedditFullname
} from "../../util";
import Snoowrap from "snoowrap";
import {ModActionType, ModUserNoteLabel} from "../../Common/Infrastructure/Atomic";
import {MaybeActivityType, RedditThing, SnoowrapActivity} from "../../Common/Infrastructure/Reddit";
import {
    FullModActionCriteria,
    FullModLogCriteria,
    FullModNoteCriteria
} from "../../Common/Infrastructure/Filters/FilterCriteria";
import {CMError} from "../../Utils/Errors";

export interface ModNoteSnoowrapPopulated extends Omit<ModNoteRaw, 'subreddit' | 'user'> {
    subreddit: Subreddit
    user: RedditUser
}

export interface CreateModNoteData {
    user: RedditUser
    subreddit: Subreddit
    activity?: Submission | Comment | RedditUser
    label?: ModUserNoteLabel
    note?: string
}

export const asCreateModNoteData = (val: any): val is CreateModNoteData => {
    if(val !== null && typeof val === 'object') {
        return val.user instanceof RedditUser && val.subreddit instanceof Subreddit && typeof val.note === 'string';
    }
    return false;
}


export interface ModNoteRaw {
    subreddit: string
    subreddit_id: string

    user: string
    user_id: string

    operator: string
    operator_id: string

    id: string
    created_at: number
    cursor?: string
    type: ModActionType | string
    mod_action_data: ModActionRaw
    user_note_data: ModUserNoteRaw
}

export class ModNote {

    createdBy: RedditUser | Subreddit
    createdByName?: string
    createdAt: Dayjs
    action: ModAction
    note: ModUserNote
    user: RedditUser
    operatorVal: string
    cursor?: string
    id: string
    subreddit: Subreddit
    type: ModActionType | string


    constructor(data: ModNoteRaw, client: Snoowrap) {

        this.createdByName = data.operator;
        this.createdAt = dayjs.unix(data.created_at);
        this.id = data.id;
        this.type = data.type;
        this.cursor = data.cursor;

        this.subreddit = new Subreddit({display_name: data.subreddit, id: data.subreddit_id}, client, false);
        this.user = new RedditUser({name: data.user, id: data.user_id}, client, false);

        this.operatorVal = data.operator;

        const opThing = parseRedditFullname(data.operator_id) as RedditThing;
        this.createdBy = generateSnoowrapEntityFromRedditThing(opThing, client) as RedditUser | Subreddit;
        if (this.createdBy instanceof RedditUser) {
            this.createdBy.name = data.operator;
        }

        this.action = new ModAction(data.mod_action_data, client);
        if (this.action.actedOn instanceof RedditUser) {
            if(this.action.actedOn.id === this.user.id) {
                this.action.actedOn = this.user;
            }/* else if(data.operator !== undefined) {
                this.action.actedOn.name = data.operator;
            }*/
        }

        this.note = new ModUserNote(data.user_note_data, client);
        if (this.note.actedOn instanceof RedditUser && this.note.actedOn.id === this.user.id) {
            this.note.actedOn = this.user;
        }
    }

    toRaw(): ModNoteRaw {
        return {
            subreddit: this.subreddit.display_name,
            subreddit_id: this.subreddit.id,

            user: this.user.name,
            user_id: this.user.id,

            operator: this.operatorVal,
            operator_id: this.createdBy.id,

            mod_action_data: this.action.toRaw(),

            id: this.id,
            user_note_data: this.note.toRaw(),
            created_at: this.createdAt.unix(),
            type: this.type,
            cursor: this.cursor
        }
    }

    toJSON() {
        return this.toRaw();
    }

    matchesModActionCriteria(fullCrit: FullModActionCriteria, referenceItem?: SnoowrapActivity) {
        const {count: {duration} = {}, activityType, referencesCurrentActivity, type} = fullCrit;

        let cutoffDate: Dayjs | undefined;

        if (duration !== undefined) {
            // filter out any notes that occur before time range
            cutoffDate = dayjs().subtract(duration);
            if (this.createdAt.isBefore(cutoffDate)) {
                return false;
            }
        }

        if (activityType !== undefined) {
            const anyMatch = activityType.some((a: MaybeActivityType) => {
                switch (a) {
                    case 'submission':
                        return isSubmission(this.action.actedOn);
                    case 'comment':
                        return isComment(this.action.actedOn);
                    case false:
                        return this.action.actedOn === undefined || (!asSubmission(this.action.actedOn) && !asComment(this.action.actedOn));
                }
            });
            if (!anyMatch) {
                return false;
            }
        }

        if (referencesCurrentActivity !== undefined) {
            if (referenceItem === undefined) {
                throw new CMError('Criteria wants to check if mod note references activity but not activity was given.');
            }
            let isCurrentActivity = false;
            if(referenceItem !== undefined) {
                if(this.action.actedOn !== undefined) {
                    isCurrentActivity = this.action.actedOn.name === referenceItem.name;
                }
                if(isCurrentActivity === false && this.note !== undefined && this.note.actedOn !== undefined) {
                    isCurrentActivity = this.note.actedOn.name === referenceItem.name;
                }
            }
            if ((referencesCurrentActivity === true && !isCurrentActivity) || (referencesCurrentActivity === false && isCurrentActivity)) {
                return false;
            }
        }

        if (type !== undefined) {
            if (!type.includes((this.type as ModActionType))) {
                return false
            }
        }

        return true;
    }

    matchesModLogCriteria(fullCrit: FullModLogCriteria, referenceItem: SnoowrapActivity) {
        if (!this.matchesModActionCriteria({
            type: ['NOTE'], // default to filtering by note type but allow overriding?
            ...fullCrit
        }, referenceItem)) {
            return false;
        }
        const fullCritEntries = Object.entries(fullCrit);

        for (const [k, v] of fullCritEntries) {
            const key = k.toLocaleLowerCase();
            switch (key) {
                case 'description':
                case 'action':
                case 'details':
                    const actionPropVal = this.action[key] as string;
                    if (actionPropVal === undefined) {
                        return false;
                    }
                    const anyPropMatch = v.some((y: RegExp) => y.test(actionPropVal));
                    if (!anyPropMatch) {
                        return false;
                    }
                    break;
            }
        }

        return true;
    }

    matchesModNoteCriteria(fullCrit: FullModNoteCriteria, referenceItem: SnoowrapActivity) {
        if(!this.matchesModActionCriteria(fullCrit, referenceItem)) {
            return false;
        }
        const fullCritEntries = Object.entries(fullCrit);

        for (const [k, v] of fullCritEntries) {
            const key = k.toLocaleLowerCase();
            switch (key) {
                case 'notetype':
                    if (!v.map((x: ModUserNoteLabel) => x.toUpperCase()).includes((this.note.label as ModUserNoteLabel))) {
                        return false
                    }
                    break;
                case 'note':
                    const actionPropVal = this.note.note;
                    if (actionPropVal === undefined) {
                        return false;
                    }
                    const anyPropMatch = v.some((y: RegExp) => y.test(actionPropVal));
                    if (!anyPropMatch) {
                        return false;
                    }
                    break;
            }
        }

        return true;
    }
}
