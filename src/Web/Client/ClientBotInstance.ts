import {
    BotInstance,
    BotInstanceResponse, BotSubredditInviteResponse,
    CMInstanceInterface,
    ManagerResponse,
    NormalizedManagerResponse
} from '../Common/interfaces';
import {intersect, parseRedditEntity} from "../../util";

export class ClientBotInstance implements BotInstance {
    instance: CMInstanceInterface;
    botName: string;
   // botLink: string;
    error?: string | undefined;
    managers: NormalizedManagerResponse[];
    nanny?: string | undefined;
    running: boolean;
    invites: BotSubredditInviteResponse[]

    constructor(data: BotInstanceResponse, instance: CMInstanceInterface) {
        this.instance = instance;
        this.botName = data.botName;
        //this.botLink = data.botLink;
        this.error = data.error;
        this.managers = data.managers.map(x => ({...x, subredditNormal: parseRedditEntity(x.subreddit).name}));
        this.nanny = data.nanny;
        this.running = data.running;
        this.invites = data.invites;
    }

    getManagerNames(): string[] {
        return this.managers.map(x => x.name);
    }

    getSubreddits(normalized = true): string[] {
        return normalized ? this.managers.map(x => x.subredditNormal) : this.managers.map(x => x.subreddit);
    }

    getAccessibleSubreddits(user: string, subreddits: string[] = []): string[] {
        const normalSubs = subreddits.map(x => parseRedditEntity(x).name);
        return Array.from(new Set([...this.getGuestSubreddits(user), ...intersect(normalSubs, this.getSubreddits())]));
    }

    getGuestManagers(user: string): NormalizedManagerResponse[] {
        const louser = user.toLowerCase();
        return this.managers.filter(x => x.guests.map(y => y.name.toLowerCase()).includes(louser));
    }

    getGuestSubreddits(user: string): string[] {
        return this.getGuestManagers(user).map(x => x.subredditNormal);
    }

    canUserAccessBot(user: string, subreddits: string[] = []) {
        return this.getAccessibleSubreddits(user, subreddits).length > 0;
    }

    canUserAccessSubreddit(subreddit: string, user: string, subreddits: string[] = []): boolean {
       return this.getAccessibleSubreddits(user, subreddits).includes(parseRedditEntity(subreddit).name);
    }

    getInvites() {
        return this.invites;
    }

    getInvite(val: string) {
        return this.invites.find(x => x.id === val);
    }

}

export default ClientBotInstance;
