import {URLSearchParams} from "url";
import fetch from "node-fetch";
import {parseUsableLinkIdentifier} from "../../util";
import dayjs from "dayjs";
import {youtube, youtube_v3 } from '@googleapis/youtube';
import Schema$CommentThread = youtube_v3.Schema$CommentThread;
import {RepostItem} from "../../Common/interfaces";

const parseYtIdentifier = parseUsableLinkIdentifier();

export class YoutubeClient {
    apiKey: string;
    client: youtube_v3.Youtube

    constructor(key: string) {
        this.apiKey = key;
        this.client = youtube({version: 'v3', auth: key});
    }

    getVideoTopComments = async (url: string, maxResults: number = 50): Promise<Schema$CommentThread[]> => {

        const videoId = parseYtIdentifier(url);

        const res = await this.client.commentThreads.list({
            part: ['snippet'],
            videoId,
            maxResults: maxResults,
            textFormat: 'plainText',
            order: 'relevance',
        });

        const items = res.data.items as Schema$CommentThread[];
        items.sort((a, b) => (a.snippet?.topLevelComment?.snippet?.likeCount as number) - (b.snippet?.topLevelComment?.snippet?.likeCount as number)).reverse();

        return items;
    }
}


export const commentsAsRepostItems = (comments: Schema$CommentThread[]): RepostItem[] => {
    return comments.map((x) => {
        const textDisplay = x.snippet?.topLevelComment?.snippet?.textDisplay;
        const publishedAt = x.snippet?.topLevelComment?.snippet?.publishedAt;
        const id = x.snippet?.topLevelComment?.id;
        const videoId = x.snippet?.topLevelComment?.snippet?.videoId;

        return {
            value: textDisplay as string,
            createdOn: dayjs(publishedAt as string).unix(),
            source: 'Youtube',
            sourceUrl: `https://youtube.com/watch?v=${videoId}&lc=${id}`,
            score: x.snippet?.topLevelComment?.snippet?.likeCount as number,
            acquisitionType: 'external',
            itemType: 'comment'
        };
    })
}

