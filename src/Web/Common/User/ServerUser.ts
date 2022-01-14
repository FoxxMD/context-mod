import {BotInstance, CMInstance} from "../../interfaces";
import CMUser from "./CMUser";
import {intersect, parseRedditEntity} from "../../../util";
import {App} from "../../../App";
import Bot from "../../../Bot";
import {Manager} from "../../../Subreddit/Manager";

class ServerUser extends CMUser<App, Bot, Manager> {

    constructor(public name: string, public subreddits: string[], public machine: boolean, public isOperator: boolean) {
        super(name, subreddits);
    }

    isInstanceOperator(): boolean {
        return this.isOperator;
    }

    canAccessInstance(val: App): boolean {
        return this.isOperator || val.bots.filter(x => intersect(this.subreddits, x.subManagers.map(y => y.subreddit.display_name))).length > 0;
    }

    canAccessBot(val: Bot): boolean {
        return this.isOperator || intersect(this.subreddits, val.subManagers.map(y => y.subreddit.display_name)).length > 0;
    }

    accessibleBots(bots: Bot[]): Bot[] {
        return this.isOperator ? bots : bots.filter(x => intersect(this.subreddits, x.subManagers.map(y => y.subreddit.display_name)).length > 0);
    }

    canAccessSubreddit(val: Bot, name: string): boolean {
        return this.isOperator || this.subreddits.includes(parseRedditEntity(name).name) && val.subManagers.some(y => y.subreddit.display_name.toLowerCase() === parseRedditEntity(name).name.toLowerCase());
    }

    accessibleSubreddits(bot: Bot): Manager[] {
        return this.isOperator ? bot.subManagers : bot.subManagers.filter(x => intersect(this.subreddits, [x.subreddit.display_name]).length > 0);
    }
}

export default ServerUser;
