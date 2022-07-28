import {Request, Response} from 'express';
import {authUserCheck, botRoute, subredditRoute} from "../../../middleware";
import Submission from "snoowrap/dist/objects/Submission";
import winston from 'winston';
import {COMMENT_URL_ID, parseLinkIdentifier, parseRedditThingsFromLink, SUBMISSION_URL_ID} from "../../../../../util";
import {booleanMiddle} from "../../../../Common/middleware";
import {Manager} from "../../../../../Subreddit/Manager";
import {ActionedEvent} from "../../../../../Common/interfaces";
import {CMEvent, CMEvent as ActionedEventEntity} from "../../../../../Common/Entities/CMEvent";
import {nanoid} from "nanoid";
import dayjs from "dayjs";
import {
    emptyEventResults,
    EventConditions,
    getDistinctEventIdsWhereQuery,
    getFullEventsById,
    paginateRequest
} from "../../../../Common/util";
import {filterResultsBuilder} from "../../../../../Utils/typeormUtils";
import {Brackets} from "typeorm";
import {Activity} from "../../../../../Common/Entities/Activity";
import {RedditThing} from "../../../../../Common/Infrastructure/Reddit";
import {CMError} from "../../../../../Utils/Errors";
import {Guest, GuestEntityData} from "../../../../../Common/Entities/Guest/GuestInterfaces";
import {
    guestEntitiesToAll,
    guestEntityToApiGuest,
    ManagerGuestEntity
} from "../../../../../Common/Entities/Guest/GuestEntity";
import {ManagerEntity} from "../../../../../Common/Entities/ManagerEntity";
import {AuthorEntity} from "../../../../../Common/Entities/AuthorEntity";

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

const config = async (req: Request, res: Response) => {

    const manager = req.manager as Manager;

    // @ts-ignore
    const wiki = await manager.subreddit.getWikiPage(manager.wikiLocation).fetch();
    return res.send(wiki.content_md);
};
export const configRoute = [authUserCheck(), botRoute(), subredditRoute(), config];

const configLocation = async (req: Request, res: Response) => {
    const manager = req.manager as Manager;
    return res.send(manager.wikiLocation);
};

export const configLocationRoute = [authUserCheck(), botRoute(), subredditRoute(), configLocation];

const getInvites = async (req: Request, res: Response) => {

    return res.json(await req.serverBot.cacheManager.getPendingSubredditInvites());
};

export const getInvitesRoute = [authUserCheck(), botRoute(), getInvites];

const addInvite = async (req: Request, res: Response) => {

    const {subreddit} = req.body as any;
    if (subreddit === undefined || subreddit === null || subreddit === '') {
        return res.status(400).send('subreddit must be defined');
    }
    try {
        await req.serverBot.cacheManager.addPendingSubredditInvite(subreddit);
    } catch (e: any) {
        if(e instanceof CMError) {
            req.logger.warn(e);
            return res.status(400).send(e.message);
        } else {
            req.logger.error(e);
            return res.status(500).send(e.message);
        }
    }
    return res.status(200).send();
};

export const addInviteRoute = [authUserCheck(), botRoute(), addInvite];

const deleteInvite = async (req: Request, res: Response) => {

    const {subreddit} = req.query as any;
    if (subreddit === undefined || subreddit === null || subreddit === '') {
        return res.status(400).send('subreddit must be defined');
    }
    await req.serverBot.cacheManager.deletePendingSubredditInvite(subreddit);
    return res.status(200).send();
};

export const deleteInviteRoute = [authUserCheck(), botRoute(), deleteInvite];

const actionedEvents = async (req: Request, res: Response) => {

    const {
        permalink,
        related,
        author
    } = req.query as any;

    let managers: Manager[] = [];
    const manager = req.manager as Manager | undefined;
    if(manager !== undefined) {
        managers.push(manager);
    } else {
        for(const manager of req.serverBot.subManagers) {
            if(req.user?.canAccessSubreddit(req.serverBot, manager.subreddit.display_name)) {
                managers.push(manager);
            }
        }
    }

    const opts: EventConditions = {
        managerIds: managers.map(x => x.managerEntity.id),
        related,
        author
    };
    if(permalink !== undefined) {
        const things = parseRedditThingsFromLink(permalink);
        const actRepo = req.serverBot.database.getRepository(Activity);

        if(things.comment === undefined && things.submission === undefined) {
            throw new Error('Could not parse comment or submission id from link');
        }

        const idToUse = things.comment !== undefined ? things.comment.val : things.submission?.val;

        const activity = await actRepo.findOne({where: {'_id': idToUse}, relations: {submission: true, author: true}});

        if(activity === null) {
            return res.json(emptyEventResults());
        }

        opts.activity = activity;
    }

    const paginatedIdResults = await paginateRequest(getDistinctEventIdsWhereQuery(req.serverBot.database, opts), req);

    const hydratedResults = await getFullEventsById(req.serverBot.database, paginatedIdResults.data.map((x: CMEvent) => x.id)).getMany();


    // TODO will need to refactor this if we switch to allowing subreddits to use their own datasources
    //const results = await paginateRequest(query, req);
    return res.json({...paginatedIdResults, data: hydratedResults});
};
export const actionedEventsRoute = [authUserCheck(), botRoute(), subredditRoute(false), actionedEvents];

const action = async (req: Request, res: Response) => {
    const bot = req.serverBot;

    const {url, dryRun = false, subreddit, delayOption = 'asis'} = req.query as any;
    const {name: userName} = req.user as Express.User;

    let a;
    const commentId = commentReg(url);
    if (commentId !== undefined) {
        // @ts-ignore
        a = await bot.client.getComment(commentId);
    }
    if (a === undefined) {
        const submissionId = submissionReg(url);
        if (submissionId !== undefined) {
            // @ts-ignore
            a = await bot.client.getSubmission(submissionId);
        }
    }

    if (a === undefined) {
        winston.loggers.get('app').error('Could not parse Comment or Submission ID from given URL', {user: userName});
        return res.send('OK');
    } else {
        // @ts-ignore
        const activity = await a.fetch();
        const sub = await activity.subreddit.display_name;

        let manager = subreddit === 'All' ? bot.subManagers.find(x => x.subreddit.display_name === sub) : bot.subManagers.find(x => x.displayLabel === subreddit);

        if (manager === undefined || !req.user?.canAccessSubreddit(req.serverBot, manager.subreddit.display_name)) {
            let msg = 'Activity does not belong to a subreddit you moderate or the bot runs on.';
            if (subreddit === 'All') {
                msg = `${msg} If you want to test an Activity against a Subreddit's config it does not belong to then switch to that Subreddit's tab first.`
            }
            winston.loggers.get('app').error(msg, {user: userName});
            return res.send('OK');
        }

        // will run dryrun if specified or if running activity on subreddit it does not belong to
        const dr: boolean | undefined = (dryRun || manager.subreddit.display_name !== sub) ? true : undefined;
        manager.logger.info(`/u/${userName} Queued ${dr === true ? 'DRY RUN ' : ''}check on ${manager.subreddit.display_name !== sub ? 'FOREIGN ACTIVITY ' : ''}${url}`, {user: userName, subreddit});
        await manager.firehose.push({
            activity, options: {
                dryRun: dr,
                disableDispatchDelays: delayOption !== 'asis',
                force: true,
                source: `user:${userName}`,
                activitySource: {
                    id: nanoid(16),
                    type: 'user',
                    identifier: userName,
                    queuedAt: dayjs(),
                }
            }
        })
    }
    res.send('OK');
};

export const actionRoute = [authUserCheck(), botRoute(), booleanMiddle(['dryRun']), action];

const cancelDelayed = async (req: Request, res: Response) => {

    const {id} = req.query as any;
    const {name: userName} = req.user as Express.User;

    if (req.manager?.resources === undefined) {
        req.manager?.logger.error('Subreddit does not have delayed items!', {user: userName});
        return res.status(400).send();
    }

    if (id === undefined) {
        await req.manager.resources.removeDelayedActivity();
    } else {
        const delayedItem = req.manager.resources.delayedItems.find(x => x.id === id);
        if (delayedItem === undefined) {
            req.manager?.logger.error(`No delayed items exists with the id ${id}`, {user: userName});
            return res.status(400).send();
        }

        await req.manager.resources.removeDelayedActivity(delayedItem.id);
        req.manager?.logger.info(`Remove Delayed Item '${delayedItem.id}'`, {user: userName});
    }

    return res.send('OK');
};

export const cancelDelayedRoute = [authUserCheck(), botRoute(), subredditRoute(true), cancelDelayed];

const removeGuestMod = async (req: Request, res: Response) => {

    const {name} = req.query as any;
    const {name: userName} = req.user as Express.User;

    const isAll = req.manager === undefined;

    const managers = (isAll ? req.user?.accessibleSubreddits(req.serverBot) : [req.manager as Manager]) as Manager[];

    const managerRepo = req.serverBot.database.getRepository(ManagerEntity);

    let newGuests = new Map<string, Guest[]>();
    for(const m of managers) {
        const filteredGuests = m.managerEntity.removeGuestByUser(name);
        newGuests.set(m.displayLabel, filteredGuests.map(x => guestEntityToApiGuest(x)));
        m.logger.info(`Removed ${name} from Guest Mods`, {user: userName});
    }
    await managerRepo.save(managers.map(x => x.managerEntity));

    const guests = isAll ? guestEntitiesToAll(newGuests) : Array.from(newGuests.values()).flat(3);

    return res.json(guests);
};

export const removeGuestModRoute = [authUserCheck(), botRoute(), subredditRoute(true), removeGuestMod];

const addGuestMod = async (req: Request, res: Response) => {

    const {name, time} = req.query as any;
    const {name: userName} = req.user as Express.User;

    const isAll = req.manager === undefined;

    const managers = (isAll ? req.user?.accessibleSubreddits(req.serverBot) : [req.manager as Manager]) as Manager[];

    const managerRepo = req.serverBot.database.getRepository(ManagerEntity);
    const authorRepo = req.serverBot.database.getRepository(AuthorEntity);

    let user = await authorRepo.findOne({
        where: {
            name: name as string,
        }
    });

    if(user === null) {
        user = await authorRepo.save(new AuthorEntity({name}))
    }

    // TODO this is not using the right time?
    const expiresAt = dayjs(Number.parseInt(time));

    let newGuests = new Map<string, Guest[]>();
    for(const m of managers) {
        const filteredGuests = m.managerEntity.addGuest({author: user, expiresAt});
        newGuests.set(m.displayLabel, filteredGuests.map(x => guestEntityToApiGuest(x)));
        m.logger.info(`Added ${name} from Guest Mods`, {user: userName});
    }
    await managerRepo.save(managers.map(x => x.managerEntity));

    const guests = isAll ? guestEntitiesToAll(newGuests) : Array.from(newGuests.values()).flat(3);

    return res.status(200).json(guests);
};

export const addGuestModRoute = [authUserCheck(), botRoute(), subredditRoute(true), addGuestMod];
