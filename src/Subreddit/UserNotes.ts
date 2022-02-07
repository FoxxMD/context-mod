import dayjs, {Dayjs} from "dayjs";
import Snoowrap, {Comment, RedditUser, WikiPage} from "snoowrap";
import {
    COMMENT_URL_ID,
    deflateUserNotes, getActivityAuthorName,
    inflateUserNotes,
    parseLinkIdentifier,
    SUBMISSION_URL_ID
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
    l: string;
    /**
     * type/color index from constants.warnings
     * */
    w: number;
}

export type UserNotesConstants = Pick<any, "users" | "warnings">;

export class UserNotes {
    notesTTL: number | false;
    subreddit: Subreddit;
    client: Snoowrap;
    moderators?: RedditUser[];
    logger: Logger;
    identifier: string;
    cache: Cache
    cacheCB: Function;

    users: Map<string, UserNote[]> = new Map();

    saveDebounce: any;
    debounceCB: any;
    batchCount: number = 0;

    constructor(ttl: number | boolean, subreddit: Subreddit, client: Snoowrap, logger: Logger, cache: Cache, cacheCB: Function) {
        this.notesTTL = ttl === true ? 0 : ttl;
        this.subreddit = subreddit;
        this.logger = logger;
        this.identifier = `${this.subreddit.display_name}-usernotes`;
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
            const notes = rawNotes.ns.map(x => UserNote.fromRaw(x, payload.constants, this.moderators as RedditUser[]));
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

    async addUserNote(item: (Submission|Comment), type: string | number, text: string = ''): Promise<UserNote>
    {
        const payload = await this.retrieveData();
        const userName = getActivityAuthorName(item.author);

        // idgaf
        // @ts-ignore
        const mod = await this.subreddit._r.getMe();
        if(!payload.constants.users.includes(mod.name)) {
            this.logger.info(`Mod ${mod.name} does not exist in UserNote constants, adding them`);
            payload.constants.users.push(mod.name);
        }
        if(!payload.constants.warnings.find((x: string) => x === type)) {
            this.logger.warn(`UserNote type '${type}' does not exist, adding it but make sure spelling and letter case is correct`);
            payload.constants.warnings.push(type);
            //throw new LoggedError(`UserNote type '${type}' does not exist. If you meant to use this please add it through Toolbox first.`);
        }
        const newNote = new UserNote(dayjs(), text, mod, type, `https://reddit.com${item.permalink}`);

        if(payload.blob[userName] === undefined) {
            payload.blob[userName] = {ns: []};
        }
        payload.blob[userName].ns.push(newNote.toRaw(payload.constants));

        await this.saveData(payload);
        if(this.notesTTL > 0) {
            const currNotes = this.users.get(userName) || [];
            currNotes.push(newNote);
            this.users.set(userName, currNotes);
        }
        return newNote;
    }

    async warningExists(type: string): Promise<boolean>
    {
        const payload = await this.retrieveData();
        return payload.constants.warnings.some((x: string) => x === type);
    }

    async retrieveData(): Promise<RawUserNotesPayload> {
        let cacheMiss;
        if (this.notesTTL > 0) {
            const cachedPayload = await this.cache.get(this.identifier);
            if (cachedPayload !== undefined && cachedPayload !== null) {
                this.cacheCB(false);
                return cachedPayload as unknown as RawUserNotesPayload;
            }
            this.cacheCB(true);
            cacheMiss = true;
        }

        try {
            // DISABLED for now because I think its causing issues
            // if(cacheMiss && this.debounceCB !== undefined) {
            //     // timeout is still delayed. its our wiki data and we want it now! cm cacheworth 877 cache now
            //     this.logger.debug(`Detected missed cache on usernotes retrieval while batch (${this.batchCount}) save is in progress, executing save immediately before retrieving new notes...`);
            //     clearTimeout(this.saveDebounce);
            //     await this.debounceCB();
            //     this.debounceCB = undefined;
            //     this.saveDebounce = undefined;
            // }
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

    async saveData(payload: RawUserNotesPayload): Promise<RawUserNotesPayload> {

        const blob = deflateUserNotes(payload.blob);
        const wikiPayload = {text: JSON.stringify({...payload, blob}), reason: 'ContextBot edited usernotes'};
        try {
            const wiki = this.client.getSubreddit(this.subreddit.display_name).getWikiPage('usernotes');
            if (this.notesTTL !== false) {
                // DISABLED for now because if it fails throws an uncaught rejection
                // and need to figured out how to handle this other than just logging (want to interrupt action flow too?)
                //
                // debounce usernote save by 5 seconds -- effectively batch usernote saves
                //
                // so that if we are processing a ton of checks that write user notes we aren't calling to save the wiki page on every call
                // since we also have everything in cache (most likely...)
                //
                // TODO might want to increase timeout to 10 seconds
                // if(this.saveDebounce !== undefined) {
                //     clearTimeout(this.saveDebounce);
                // }
                // this.debounceCB = (async function () {
                //     const p = wikiPayload;
                //     // @ts-ignore
                //     const self = this as UserNotes;
                //     // @ts-ignore
                //     self.wiki = await self.subreddit.getWikiPage('usernotes').edit(p);
                //     self.logger.debug(`Batch saved ${self.batchCount} usernotes`);
                //     self.debounceCB = undefined;
                //     self.saveDebounce = undefined;
                //     self.batchCount = 0;
                // }).bind(this);
                // this.saveDebounce = setTimeout(this.debounceCB,5000);
                // this.batchCount++;
                // this.logger.debug(`Saving Usernotes has been debounced for 5 seconds (${this.batchCount} batched)`)

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

    constructor(public time: Dayjs, public text: string, public moderator: RedditUser, public noteType: string | number, public link: string) {

    }

    public toRaw(constants: UserNotesConstants): RawNote {
        return {
            t: this.time.unix(),
            n: this.text,
            m: constants.users.findIndex((x: string) => x === this.moderator.name),
            w: typeof this.noteType === 'number' ? this.noteType : constants.warnings.findIndex((x: string) => x === this.noteType),
            l: usernoteLinkShorthand(this.link)
        }
    }

    public static fromRaw(obj: RawNote, constants: UserNotesConstants, mods: RedditUser[]) {
        const mod = mods.find(x => x.name === constants.users[obj.m]);
        if (mod === undefined) {
            throw new Error('Could not find moderator for Usernote');
        }
        return new UserNote(dayjs.unix(obj.t), obj.n, mod, constants.warnings[obj.w] === null ? obj.w : constants.warnings[obj.w], usernoteLinkExpand(obj.l))
    }
}

// https://github.com/toolbox-team/reddit-moderator-toolbox/wiki/Subreddit-Wikis%3A-usernotes#link-string-formats
export const usernoteLinkExpand = (link: string) => {
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
export const usernoteLinkShorthand = (link: string) => {

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
