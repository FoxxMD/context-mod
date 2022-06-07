import {App} from "../../App";
import {BotStats} from "./interfaces";
import dayjs from "dayjs";
import {formatNumber, parseRedditEntity} from "../../util";
import Bot from "../../Bot";
import {Brackets, DataSource, SelectQueryBuilder, WhereExpressionBuilder} from "typeorm";
import {Request} from "express";
import {CMEvent} from "../../Common/Entities/CMEvent";
import {filterResultsBuilder} from "../../Utils/typeormUtils";
import {Activity} from "../../Common/Entities/Activity";

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

export function getPerPage(req: Request, defaultPerPage:number = 15) {
    return parseInt(req.query.per_page as string)|| defaultPerPage
}
export function getPage(req: Request, defaultPage:number=1) {
    return parseInt(req.query.page as string) || defaultPage
}

export interface PaginationAwareObject {
    from: any,
    to: any,
    per_page: any,
    total: number|any,
    current_page: number,
    prev_page?: number|null,
    next_page?: number|null,
    last_page: number|null
    data: Array<object|any>|any
}

export const paginateRequest = async (builder: SelectQueryBuilder<any>, req: Request, defaultPerPage: number = 15, maxPerPage: number = 100): Promise<PaginationAwareObject> => {
    const per_page = Math.min(getPerPage(req, defaultPerPage), maxPerPage);
    const page = getPage(req);

    let skip = (page-1)*per_page;

    let [res,count] = await builder
        .skip(skip)
        .take(per_page)
        .getManyAndCount();

    const calcule_last_page = count % per_page;
    const last_page = calcule_last_page === 0 ? count / per_page : Math.trunc(count / per_page) + 1;

    return {
        from:       skip<=count ? skip+1 : null,
        to:         (count > skip+per_page) ? skip+per_page : count,
        per_page:   per_page,
        total:      count,
        current_page: page,
        prev_page:  page > 1? (page-1): null,
        next_page:  count > (skip + per_page) ? page+1 : null,
        last_page:  last_page,
        data:       res || []
    }
}

export const emptyEventResults = () => ({
    from:       null,
    to:         0,
    per_page:   15,
    total:      0,
    current_page: 1,
    prev_page:  null,
    next_page:  null,
    last_page:  0,
    data:       []
})

export const orByRelatedActivities = (activity: Activity, qb: WhereExpressionBuilder): void => {
    if(activity.type === 'comment' && activity.submission !== undefined) {
        qb.where('activity._id = :actId', {actId: activity.id})
            .orWhere('activity._id = :subId', {subId: activity.submission?.id});
    } else if (activity.type === 'submission') {
        qb.where('activity._id = :actId', {actId: activity.id})
            .orWhere('activitySubmission._id = :subId', {subId: activity.id});
    }
}

export const orByRelatedAuthor = (activity: Activity, qb: WhereExpressionBuilder): void => {
    qb.where('author.name = :authorName', {authorName: activity.author.name});
}

export interface EventConditions {
    managerIds: string[]
    related?: string
    activity?: Activity
    author?: string
}

export const getSimpleEventsWhereQuery = (dataSource: DataSource, opts: EventConditions): SelectQueryBuilder<CMEvent> => {
    const query = dataSource.getRepository(CMEvent)
        .createQueryBuilder("event");

    const {
        managerIds,
        related,
        activity,
        author,
    } = opts;

    query.andWhere('event.manager.id IN (:...managerIds)', {managerIds: managerIds});

    if (activity !== undefined) {
        query.leftJoinAndSelect('event.activity', 'activity');

        if (related === undefined) {
            query.andWhere('activity._id = :actId', {actId: activity.id});
        } else {
            if (related === 'all') {
                query.leftJoinAndSelect('activity.author', 'author')
                query.andWhere(new Brackets((qb) => {
                    qb.where(new Brackets(qbAct => orByRelatedActivities(activity, qbAct)))
                        .orWhere(new Brackets(qbAuthor => orByRelatedAuthor(activity, qbAuthor)));
                }))
            } else if (related === 'activity') {
                query.andWhere(new Brackets((qb) => orByRelatedActivities(activity, qb)));
            } else if (related === 'author') {
                query.leftJoinAndSelect('activity.author', 'author')
                query.andWhere(new Brackets((qb) => orByRelatedAuthor(activity, qb)));
            }
        }
    } else if(author !== undefined) {
        const authorVal = parseRedditEntity(author, 'user');

        query.leftJoinAndSelect('event.activity', 'activity');
        query.leftJoinAndSelect('activity.author', 'author')
            .andWhere('author.name = :authorName', {authorName: authorVal.name});
    }

    // can't order by using this AND use "select event id only" in getDistinctEventIdsWhereQuery
    // due to bug in how typeorm handles wrapping sub select for count when using take/skip

    // https://github.com/typeorm/typeorm/issues/4742#issuecomment-858333515
    // https://github.com/typeorm/typeorm/issues/747
    // https://github.com/typeorm/typeorm/issues/3501

    //query.orderBy('event._processedAt', 'DESC');
    query.orderBy('event._processedAt', 'DESC');
    //query.orderBy({'event._processedAt':'DESC'});

    return query;
}

export const getDistinctEventIdsWhereQuery = (dataSource: DataSource, opts: EventConditions): SelectQueryBuilder<CMEvent> => {
    const query = getSimpleEventsWhereQuery(dataSource, opts);

    // see comments about order by and take/skip in getSimpleEventsWhereQuery
    //query.select('event.id');

    return query;
}

export const getFullEventsById = (dataSource: DataSource, ids: string[]): SelectQueryBuilder<CMEvent> => {
    let query = dataSource.getRepository(CMEvent)
        .createQueryBuilder("event")
        .leftJoinAndSelect('event.source', 'source')
        .leftJoinAndSelect('event.activity', 'activity')
        .leftJoinAndSelect('activity.subreddit', 'subreddit')
        .leftJoinAndSelect('activity.author', 'author')
        .leftJoinAndSelect('event.runResults', 'runResults')
        .leftJoinAndSelect('activity.submission', 'activitySubmission')
        .leftJoinAndSelect('activitySubmission.author', 'actSubAuthor');

    query = filterResultsBuilder<CMEvent>(query, 'runResults', 'rr');

    query.leftJoinAndSelect('runResults.run', 'run')
        .leftJoinAndSelect('runResults.checkResults', 'checkResults');

    query = filterResultsBuilder<CMEvent>(query, 'checkResults', 'c');

    query.leftJoinAndSelect('checkResults.ruleResults', 'rrIterim')
        .leftJoinAndSelect('rrIterim.result', 'ruleResult')
        .leftJoinAndSelect('ruleResult.premise', 'rPremise')
        .leftJoinAndSelect('rPremise.kind', 'ruleKind')
        .leftJoinAndSelect('checkResults.ruleSetResults', 'ruleSetResultsIterim')
        .leftJoinAndSelect('ruleSetResultsIterim.result', 'ruleSetResult')
        .leftJoinAndSelect('ruleSetResult._ruleResults', 'rsRuleResultsIterim')
        .leftJoinAndSelect('rsRuleResultsIterim.result', 'rsRuleResult')
        .leftJoinAndSelect('rsRuleResult.premise', 'rsPremise')
        .leftJoinAndSelect('rsPremise.kind', 'rsRuleKind')
        .leftJoinAndSelect('checkResults.check', 'check');

    query = filterResultsBuilder<CMEvent>(query, 'ruleResult', 'r');
    query = filterResultsBuilder<CMEvent>(query, 'rsRuleResult', 'rsr');

    query.leftJoinAndSelect('checkResults.actionResults', 'actionResults')
        .leftJoinAndSelect('actionResults.premise', 'aPremise')
        .leftJoinAndSelect('aPremise.kind', 'actionKind');

    query = filterResultsBuilder<CMEvent>(query, 'actionResults', 'a');

    query.orderBy('event._processedAt', 'DESC');

    query.andWhereInIds(ids);

    return query;
}
