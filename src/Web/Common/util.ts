import {App} from "../../App";
import {BotStats} from "./interfaces";
import dayjs from "dayjs";
import {formatNumber} from "../../util";
import Bot from "../../Bot";
import {SelectQueryBuilder} from "typeorm";
import {Request} from "express";
import {PaginationAwareObject} from "typeorm-pagination/dist/helpers/pagination";
import {getPage, getPerPage} from 'typeorm-pagination'
import { paginate } from 'typeorm-pagination/dist/helpers/pagination';

export const opStats = (bot: Bot): BotStats => {
    const limitReset = bot.client === undefined ? dayjs() : dayjs(bot.client.ratelimitExpiration);
    const nextHeartbeat = bot.nextHeartbeat !== undefined ? bot.nextHeartbeat.local().format('MMMM D, YYYY h:mm A Z') : 'N/A';
    const nextHeartbeatHuman = bot.nextHeartbeat !== undefined ? `in ${dayjs.duration(bot.nextHeartbeat.diff(dayjs())).humanize()}` : 'N/A'
    return {
        startedAtHuman: `${dayjs.duration(dayjs().diff(bot.startedAt)).humanize()}`,
        nextHeartbeat,
        nextHeartbeatHuman,
        apiLimit: bot.client !== undefined ? bot.client.ratelimitRemaining : 0,
        apiAvg: formatNumber(bot.apiRollingAvg),
        nannyMode: bot.nannyMode || 'Off',
        apiDepletion: bot.apiEstDepletion === undefined ? 'Not Calculated' : bot.apiEstDepletion.humanize(),
        limitReset: limitReset.format(),
        limitResetHuman: `in ${dayjs.duration(limitReset.diff(dayjs())).humanize()}`,
    }
}

export const paginateRequest = async (builder: SelectQueryBuilder<any>, req: Request, defaultPerPage: number = 15, maxPerPage: number = 100): Promise<PaginationAwareObject> => await paginate(
    // @ts-ignore
    builder,
    getPage(req),
    Math.min(getPerPage(req, defaultPerPage), maxPerPage)
);
