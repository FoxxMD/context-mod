import CMUser from "./CMUser";
import {intersect, parseRedditEntity} from "../../../util";
import {BotInstance, CMInstanceInterface} from "../interfaces";

class ClientUser extends CMUser<CMInstanceInterface, BotInstance, string> {

    isInstanceOperator(val: CMInstanceInterface): boolean {
        return val.operators.map(x=> x.toLowerCase()).includes(this.name.toLowerCase());
    }

    canAccessInstance(val: CMInstanceInterface): boolean {
        return this.isInstanceOperator(val) || val.bots.filter(x => x.canUserAccessBot(this.name, this.subreddits)).length > 0;
    }

    canAccessBot(val: BotInstance): boolean {
        return this.isInstanceOperator(val.instance) || val.canUserAccessBot(this.name, this.subreddits);
    }

    canAccessSubreddit(val: BotInstance, name: string): boolean {
        return this.isInstanceOperator(val.instance) || val.canUserAccessSubreddit(name, this.name, this.subreddits);
    }

    accessibleBots(bots: BotInstance[]): BotInstance[] {
        if (bots.length === 0) {
            return bots;
        }
        return bots.filter(x => {
            if (this.isInstanceOperator(x.instance)) {
                return true;
            }
            return x.canUserAccessBot(this.name, this.subreddits);
            //return intersect(this.subreddits, x.managers.map(y => parseRedditEntity(y).name)).length > 0
        });
    }

    accessibleSubreddits(bot: BotInstance): string[] {
        return this.isInstanceOperator(bot.instance) ? bot.getSubreddits() :  bot.getAccessibleSubreddits(this.name, this.subreddits);
    }

    isSubredditGuest(val: BotInstance, name: string): boolean {
        const normalName = parseRedditEntity(name).name;
        const manager = val.managers.find(x => x.subredditNormal === normalName);
        if(manager !== undefined) {
            return manager.guests.some(y => y.name.toLowerCase() === this.name.toLowerCase());
        }
        return false;
    }

    isSubredditMod(val: BotInstance, name: string): boolean {
        const normalName = parseRedditEntity(name).name;
        return this.canAccessSubreddit(val, name) && this.subreddits.map(x => parseRedditEntity(name).name).includes(normalName);
    }

    getModeratedSubreddits(val: BotInstance): string[] {
        const normalSubs = this.subreddits.map(x => parseRedditEntity(x).name);
        return val.managers.filter(x => normalSubs.includes(x.subredditNormal)).map(x => x.subredditNormal);
    }

}

export default ClientUser;
