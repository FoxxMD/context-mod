import {Request, Response} from 'express';
import {authUserCheck, botRoute, subredditRoute} from "../../../middleware";
import Submission from "snoowrap/dist/objects/Submission";
import winston from 'winston';
import {COMMENT_URL_ID, parseLinkIdentifier, SUBMISSION_URL_ID} from "../../../../../util";
import {booleanMiddle} from "../../../../Common/middleware";
import {Manager} from "../../../../../Subreddit/Manager";
import {ActionedEvent} from "../../../../../Common/interfaces";

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

const config = async (req: Request, res: Response) => {

    const manager = req.manager as Manager;

    // @ts-ignore
    const wiki = await manager.subreddit.getWikiPage(manager.wikiLocation).fetch();
    return res.send(wiki.content_md);
};
export const configRoute = [authUserCheck(), botRoute(), subredditRoute(), config];

const actionedEvents = async (req: Request, res: Response) => {

    let managers: Manager[] = [];
    const manager = req.manager as Manager | undefined;
    if(manager !== undefined) {
        managers.push(manager);
    } else {
        for(const manager of req.serverBot.subManagers) {
            if((req.user?.realManagers as string[]).includes(manager.displayLabel)) {
                managers.push(manager);
            }
        }
    }

    let events: ActionedEvent[] = [];
    for(const m of managers) {
        events = events.concat(await m.resources.getActionedEvents());
    }

    events.sort((a, b) => b.timestamp - a.timestamp);

    return res.json(events);
};
export const actionedEventsRoute = [authUserCheck(), botRoute(), subredditRoute(false), actionedEvents];

const action = async (req: Request, res: Response) => {
    const bot = req.serverBot;

    const {url, dryRun, subreddit} = req.query as any;
    const {name: userName, realManagers = [], isOperator} = req.user as Express.User;

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
        winston.loggers.get('app').error('Could not parse Comment or Submission ID from given URL', {subreddit: `/u/${userName}`});
        return res.send('OK');
    } else {
        // @ts-ignore
        const activity = await a.fetch();
        const sub = await activity.subreddit.display_name;

        let manager = subreddit === 'All' ? bot.subManagers.find(x => x.subreddit.display_name === sub) : bot.subManagers.find(x => x.displayLabel === subreddit);

        if (manager === undefined || (!realManagers.includes(manager.displayLabel))) {
            let msg = 'Activity does not belong to a subreddit you moderate or the bot runs on.';
            if (subreddit === 'All') {
                msg = `${msg} If you want to test an Activity against a Subreddit\'s config it does not belong to then switch to that Subreddit's tab first.`
            }
            winston.loggers.get('app').error(msg, {subreddit: `/u/${userName}`});
            return res.send('OK');
        }

        // will run dryrun if specified or if running activity on subreddit it does not belong to
        const dr: boolean | undefined = (dryRun || manager.subreddit.display_name !== sub) ? true : undefined;
        manager.logger.info(`/u/${userName} running${dr === true ? ' DRY RUN ' : ' '}check on${manager.subreddit.display_name !== sub ? ' FOREIGN ACTIVITY ' : ' '}${url}`);
        await manager.runChecks(activity instanceof Submission ? 'Submission' : 'Comment', activity, {dryRun: dr})
    }
    res.send('OK');
};

export const actionRoute = [authUserCheck(), botRoute(), booleanMiddle(['dryRun']), action];
