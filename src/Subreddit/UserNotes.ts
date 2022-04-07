import dayjs, {Dayjs} from "dayjs";
import Snoowrap, {Comment, RedditUser, WikiPage} from "snoowrap";
import {
    COMMENT_URL_ID,
    deflateUserNotes, getActivityAuthorName,
    inflateUserNotes, isSubmission,
    parseLinkIdentifier,
    SUBMISSION_URL_ID, truncateStringToLength
} from "../util";
import Subreddit from "snoowrap/dist/objects/Subreddit";
import {Logger} from "winston";
import LoggedError from "../Utils/LoggedError";
import Submission from "snoowrap/dist/objects/Submission";
import {RichContent} from "../Common/interfaces";
import {Cache} from 'cache-manager';
import {isScopeError} from "../Utils/Errors";
import {ErrorWithCause} from "pony-cause";

interface RawUserNotesPayload {
    ver: number,
    constants: UserNotesConstants,
    blob: RawBlobPayload
}

interface RawBlobPayload {
    [username: string]: RawUserNoteRoot
}

interface RawUserNoteRoot {
    ns: RawNote[]
}

export interface RawNote {
    /**
     * Note Text
     * */
    n: string;
    /**
     * Unix epoch in seconds
     * */
    t: number;
    /**
     * Moderator index from constants.users
     * */
    m: number;
    /**
     * Link shorthand
     * */
    l: (string | null);
    /**
     * type/color index from constants.warnings
     * */
    w: number;
}

export type UserNotesConstants = Pick<any, "users" | "warnings">;

// resolves as undefined when using truncateStringToLength from util.ts...probably a circular reference issue but can't address it right now
// TODO refactor this to use truncateStringToLength
const wikiReasonTruncateMax = (str: string) => str.length > 256 ? `${str.slice(0, 256 - '...'.length - 1)}...` : str;

export class UserNotes {
    notesTTL: number | false;
    subreddit: Subreddit;
    client: Snoowrap;
    moderators?: RedditUser[];
    logger: Logger;
    identifier: string;
    cache: Cache
    cacheCB: Function;
    mod?: RedditUser;

    users: Map<string, UserNote[]> = new Map();

    saveDebounce: any;
    debounceCB: any;
    batchCount: number = 0;

    constructor(ttl: number | boolean, subreddit: string, client: Snoowrap, logger: Logger, cache: Cache, cacheCB: Function) {
        this.notesTTL = ttl === true ? 0 : ttl;
        this.subreddit = client.getSubreddit(subreddit);
        this.logger = logger;
        this.identifier = `${subreddit}-usernotes`;
        this.cache = cache;
        this.cacheCB = cacheCB;
        this.client = client;
    }

    async getUserNotes(user: RedditUser): Promise<UserNote[]> {
        const userName = getActivityAuthorName(user);
        let notes: UserNote[] | undefined = [];

        if (this.users !== undefined) {
            notes = this.users.get(userName);
            if (notes !== undefined) {
                this.logger.debug('Returned cached notes');
                return notes;
            }
        }

        const payload = await this.retrieveData();
        const rawNotes = payload.blob[userName];
        if (rawNotes !== undefined) {
            if (this.moderators === undefined) {
                this.moderators = await this.subreddit.getModerators();
            }
            const notes = rawNotes.ns.map(x => UserNote.fromRaw(x, payload.constants, this.moderators as RedditUser[], this.logger));
            // sort in ascending order by time
            notes.sort((a, b) => a.time.isBefore(b.time) ? -1 : 1);
            if (this.notesTTL > 0 && this.cache !== undefined) {
                this.users.set(userName, notes);
            }
            return notes;
        } else {
            return [];
        }
    }

    // @ts-ignore
    async getMod() {
        if(this.mod === undefined) {
            // @ts-ignore
            this.mod = await this.client.getMe();
        }
        return this.mod as RedditUser;
    }

    async addUserNote(item: (Submission|Comment), type: string | number, text: string = '', wikiEditReasonPrefix?: string): Promise<UserNote>
    {
        const payload = await this.retrieveData();
        const userName = getActivityAuthorName(item.author);

        const mod = await this.getMod();
        if(!payload.constants.users.includes(mod.name)) {
            this.logger.info(`Mod ${mod.name} does not exist in UserNote constants, adding them`);
            payload.constants.users.push(mod.name);
        }
        const modIndex = payload.constants.users.findIndex((x: string) => x === mod.name);
        if(!payload.constants.warnings.find((x: string) => x === type)) {
            this.logger.warn(`UserNote type '${type}' does not exist, adding it but make sure spelling and letter case is correct`);
            payload.constants.warnings.push(type);
        }
        const newNote = new UserNote(dayjs(), text, modIndex, type, `https://reddit.com${item.permalink}`, mod);

        if(payload.blob[userName] === undefined) {
            payload.blob[userName] = {ns: []};
        }
        payload.blob[userName].ns.push(newNote.toRaw(payload.constants));


        let wikiEditReason = `Added ${type} for ${getActivityAuthorName(item.author)} on ${isSubmission(item) ? 'SUB' : 'COMM'} ${item.name}${text !== '' ? ` => ${text}` : ''}`;
        if(wikiEditReasonPrefix !== undefined) {
            wikiEditReason = `${wikiEditReasonPrefix} ${wikiEditReason}`;
        }

        const existingNotes = await this.getUserNotes(item.author);
        await this.saveData(payload, wikiEditReason);
        if(this.notesTTL > 0) {
            existingNotes.push(newNote);
            this.users.set(userName, existingNotes);
        }
        return newNote;
    }

    async warningExists(type: string): Promise<boolean>
    {
        const payload = await this.retrieveData();
        return payload.constants.warnings.some((x: string) => x === type);
    }

    async retrieveData(): Promise<RawUserNotesPayload> {
        if (this.notesTTL > 0) {
            const cachedPayload = await this.cache.get(this.identifier);
            if (cachedPayload !== undefined && cachedPayload !== null) {
                this.cacheCB(false);
                return cachedPayload as unknown as RawUserNotesPayload;
            }
            this.cacheCB(true);
        }

        try {
            // @ts-ignore
            const wiki = this.client.getSubreddit(this.subreddit.display_name).getWikiPage('usernotes');
            const wikiContent = await wiki.content_md;
            // TODO don't handle for versions lower than 6
            const userNotes = JSON.parse(wikiContent);

            userNotes.blob = inflateUserNotes(userNotes.blob);

            if (this.notesTTL !== false) {
                await this.cache.set(`${this.subreddit.display_name}-usernotes`, userNotes, {ttl: this.notesTTL});
                this.users = new Map();
            }

            return userNotes as RawUserNotesPayload;
        } catch (err: any) {
            const msg = `Could not read usernotes. Make sure at least one moderator has used toolbox and usernotes before.`;
            this.logger.error(msg, err);
            throw new LoggedError(msg);
        }
    }

    async saveData(payload: RawUserNotesPayload, reason: string = 'ContextBot edited usernotes'): Promise<RawUserNotesPayload> {

        const blob = deflateUserNotes(payload.blob);
        const wikiPayload = {text: JSON.stringify({...payload, blob}), reason: wikiReasonTruncateMax(reason)};
        try {
            const wiki = this.client.getSubreddit(this.subreddit.display_name).getWikiPage('usernotes');
            if (this.notesTTL !== false) {
                // @ts-ignore
                await wiki.edit(wikiPayload);
                await this.cache.set(this.identifier, payload, {ttl: this.notesTTL});
                this.users = new Map();
            } else {
                // @ts-ignore
                await wiki.edit(wikiPayload);
            }

            return payload as RawUserNotesPayload;
        } catch (err: any) {
            let msg = 'Could not edit usernotes!';
            // Make sure at least one moderator has used toolbox and usernotes before and that this account has editing permissions`;
            if(isScopeError(err)) {
                msg = `${msg} The bot account did not have sufficient OAUTH scope to perform this action. You must re-authenticate the bot and ensure it has has 'wikiedit' permissions.`
            } else {
                msg = `${msg} Make sure at least one moderator has used toolbox, created a usernote, and that this account has editing permissions for the wiki page.`;
            }
            throw new ErrorWithCause(msg, {cause: err});
        }
    }
}

export interface UserNoteJson extends RichContent {
    /**
     * User Note type key
     * @examples ["spamwarn"]
     * */
    type: string,
}

export class UserNote {
    //time: Dayjs;
    // text?: string;
    // moderator: RedditUser;
    // noteTypeIndex: number;
    // noteType: string | null;
    // link: string;

    constructor(public time: Dayjs, public text: string, public modIndex: number, public noteType: string | number, public link: (string | null) = null, public moderator?: RedditUser) {

    }

    public toRaw(constants: UserNotesConstants): RawNote {
        let m = this.modIndex;
        if(m === undefined && this.moderator !== undefined) {
            m = constants.users.findIndex((x: string) => x === this.moderator?.name);
        }
        return {
            t: this.time.unix(),
            n: this.text,
            m,
            w: typeof this.noteType === 'number' ? this.noteType : constants.warnings.findIndex((x: string) => x === this.noteType),
            l: usernoteLinkShorthand(this.link)
        }
    }

    public static fromRaw(obj: RawNote, constants: UserNotesConstants, mods: RedditUser[], logger?: Logger) {
        const modName = constants.users[obj.m];
        let mod;
        if(modName === undefined) {
            if(logger !== undefined) {
                logger.warn(`Usernote says a moderator should be present at index ${obj.m} but none exists there! May need to clean up usernotes in toolbox.`);
            }
        } else {
            mod = mods.find(x => x.name === constants.users[obj.m]);
        }
        if (mod === undefined && logger !== undefined) {
            logger.warn(`Usernote says it was created by user u/${modName} but they are not currently a moderator! You should cleanup usernotes in toolbox.`);
        }
        return new UserNote(dayjs.unix(obj.t), obj.n, obj.m, constants.warnings[obj.w] === null ? obj.w : constants.warnings[obj.w], usernoteLinkExpand(obj.l), mod)
    }
}

// https://github.com/toolbox-team/reddit-moderator-toolbox/wiki/Subreddit-Wikis%3A-usernotes#link-string-formats
export const usernoteLinkExpand = (link: (string | null)): (string | null) => {
    if(link === null || link === '') {
        return null;
    }
    if (link.charAt(0) === 'l') {
        const pieces = link.split(',');
        if (pieces.length === 3) {
            // it's a comment
            return `https://www.reddit.com/comments/${pieces[1]}/_/${pieces[2]}`;
        }
        // its a submission
        return `https://redd.it/${pieces[1]}`;
    } else {
        // its an old modmail thread
        return `https://www.reddit.com/message/messages/${link.split(',')[1]}`;
    }
}
export const usernoteLinkShorthand = (link: (string | null)) => {

    if(link === null || link === '') {
        return '';
    }

    const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
    const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

    let commentId = commentReg(link);
    let submissionId = submissionReg(link);

    if (commentId !== undefined) {
        commentId = commentReg(link);
        return `l,${submissionId},${commentId}`;
    } else if (submissionId !== undefined) {
        return `l,${submissionId}`;
    }

    // aren't dealing with messages at this point so just store whole thing if we didn't get a shorthand
    return link;
}

export default UserNotes;
