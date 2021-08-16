import {Request, Response} from 'express';
import {authUserCheck, botRoute} from "../../../middleware";
import Submission from "snoowrap/dist/objects/Submission";
import winston from 'winston';
import {COMMENT_URL_ID, parseLinkIdentifier, SUBMISSION_URL_ID} from "../../../../../util";
import {booleanMiddle} from "../../../../Common/middleware";

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

const config = async (req: Request, res: Response) => {
    const bot = req.serverBot;

    const {subreddit} = req.query as any;
    const {name: userName, realManagers = [], isOperator} = req.user as Express.User;
    if (!isOperator && !realManagers.includes(subreddit)) {
        return res.status(400).send('Cannot retrieve config for subreddit you do not manage or is not run by the bot')
    }
    const manager = bot.subManagers.find(x => x.displayLabel === subreddit);
    if (manager === undefined) {
        return res.status(400).send('Cannot retrieve config for subreddit you do not manage or is not run by the bot')
    }

    // @ts-ignore
    const wiki = await manager.subreddit.getWikiPage(manager.wikiLocation).fetch();
    return res.send(wiki.content_md);
};
export const configRoute = [authUserCheck(), botRoute(), config];

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
        winston.loggers.get('default').error('Could not parse Comment or Submission ID from given URL', {subreddit: `/u/${userName}`});
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
            winston.loggers.get('default').error(msg, {subreddit: `/u/${userName}`});
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
