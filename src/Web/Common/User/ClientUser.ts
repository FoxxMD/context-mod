import {BotInstance, CMInstanceInterface} from "../../interfaces";
import CMUser from "./CMUser";
import {intersect, parseRedditEntity} from "../../../util";

class ClientUser extends CMUser<CMInstanceInterface, BotInstance, string> {

    isInstanceOperator(val: CMInstanceInterface): boolean {
        return val.operators.map(x=> x.toLowerCase()).includes(this.name.toLowerCase());
    }

    canAccessInstance(val: CMInstanceInterface): boolean {
        return this.isInstanceOperator(val) || intersect(this.subreddits, val.subreddits.map(x => parseRedditEntity(x).name)).length > 0;
    }

    canAccessBot(val: BotInstance): boolean {
        return this.isInstanceOperator(val.instance) || intersect(this.subreddits, val.subreddits.map(x => parseRedditEntity(x).name)).length > 0;
    }

    canAccessSubreddit(val: BotInstance, name: string): boolean {
        return this.isInstanceOperator(val.instance) || this.subreddits.map(x => x.toLowerCase()).includes(parseRedditEntity(name).name.toLowerCase());
    }

    accessibleBots(bots: BotInstance[]): BotInstance[] {
        if (bots.length === 0) {
            return bots;
        }
        return bots.filter(x => {
            if (this.isInstanceOperator(x.instance)) {
                return true;
            }
            return intersect(this.subreddits, x.subreddits.map(y => parseRedditEntity(y).name)).length > 0
        });
    }

    accessibleSubreddits(bot: BotInstance): string[] {
        return this.isInstanceOperator(bot.instance) ? bot.subreddits.map(x => parseRedditEntity(x).name) : intersect(this.subreddits, bot.subreddits.map(x => parseRedditEntity(x).name));
    }

}

export default ClientUser;
