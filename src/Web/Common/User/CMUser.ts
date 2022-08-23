import {IUser} from "../interfaces";

export interface ClientUserData {
    token?: string
    tokenExpiresAt?: number
    scope?: string[]
    webOperator?: boolean
}

abstract class CMUser<Instance, Bot, SubredditEntity> implements IUser {
    constructor(public name: string, public subreddits: string[], public clientData: ClientUserData = {}) {

    }

    public abstract isInstanceOperator(val: Instance): boolean;
    public abstract canAccessInstance(val: Instance): boolean;
    public abstract canAccessBot(val: Bot): boolean;
    public abstract accessibleBots(bots: Bot[]): Bot[]
    public abstract canAccessSubreddit(val: Bot, name: string): boolean;
    public abstract accessibleSubreddits(bot: Bot): SubredditEntity[]
    public abstract isSubredditGuest(val: Bot, name: string): boolean;
    public abstract isSubredditMod(val: Bot, name: string): boolean;
    public abstract getModeratedSubreddits(val: Bot): SubredditEntity[]
}

export default CMUser;
