import CMUser from "./CMUser";
import {intersect, parseRedditEntity} from "../../../util";
import {App} from "../../../App";
import Bot from "../../../Bot";
import {Manager} from "../../../Subreddit/Manager";
import {BotInstance, CMInstanceInterface} from "../interfaces";

class ServerUser extends CMUser<App, Bot, Manager> {

    constructor(public name: string, public subreddits: string[], public machine: boolean, public isOperator: boolean) {
        super(name, subreddits);
    }

    isInstanceOperator(): boolean {
        return this.isOperator;
    }

    canAccessInstance(val: App): boolean {
        return this.isOperator || this.machine || val.bots.filter(x => x.canUserAccessBot(this.name, this.subreddits)).length > 0;
    }

    canAccessBot(val: Bot): boolean {
        return this.isOperator || this.machine || val.canUserAccessBot(this.name, this.subreddits);
    }

    accessibleBots(bots: Bot[]): Bot[] {
        return (this.isOperator || this.machine) ? bots : bots.filter(x => x.canUserAccessBot(this.name, this.subreddits));
    }

    canAccessSubreddit(val: Bot, name: string): boolean {
        const normalName = parseRedditEntity(name).name;
        return this.isOperator || this.machine || this.accessibleSubreddits(val).some(x => x.toNormalizedManager().subredditNormal === normalName);
    }

    accessibleSubreddits(bot: Bot): Manager[] {
        if(this.isOperator || this.machine) {
            return bot.subManagers;
        }

        const subs = bot.getAccessibleSubreddits(this.name, this.subreddits);
        return bot.subManagers.filter(x => subs.includes(x.toNormalizedManager().subredditNormal));
    }

    isSubredditGuest(val: Bot, name: string): boolean {
        const normalName = parseRedditEntity(name).name;
        const manager = val.subManagers.find(x => parseRedditEntity(x.subreddit.display_name).name === normalName);
        if(manager !== undefined) {
            return manager.toNormalizedManager().guests.some(x => x.name === this.name);
        }
        return false;
    }

    isSubredditMod(val: Bot, name: string): boolean {
        const normalName = parseRedditEntity(name).name;
        return val.subManagers.some(x => parseRedditEntity(x.subreddit.display_name).name === normalName) && this.subreddits.map(x => parseRedditEntity(x).name).some(x => x === normalName);
    }

    getModeratedSubreddits(val: Bot): Manager[] {
        const normalSubs = this.subreddits.map(x => parseRedditEntity(x).name);

        return val.subManagers.filter(x => normalSubs.includes(x.subreddit.display_name));
    }
}

export default ServerUser;
