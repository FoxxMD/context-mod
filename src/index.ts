import winston from 'winston';
import 'winston-daily-rotate-file';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import dduration from 'dayjs/plugin/duration.js';
import {Manager} from "./Subreddit/Manager";
import {Command} from 'commander';
import {getOptions} from "./Utils/CommandConfig";
import {App} from "./App";
import Submission from "snoowrap/dist/objects/Submission";

dayjs.extend(utc);
dayjs.extend(dduration);


const program = new Command();
for (const o of getOptions()) {
    program.addOption(o);
}

(async function () {
    try {

        program
            .command('run')
            .description('Runs bot normally')
            .action(async (run, command) => {
                const app = new App(program.opts());
                await app.buildManagers();
                await app.runManagers();
            });

        program
            .command('check <type> <activityId> [checkNames...]')
            .description('Run check(s) on a specific activity', {
                type: `The type of activity ('comment' or 'submission')`,
                activityId: 'The ID of the Comment or Submission',
                checkNames: 'An optional list of Checks, by name, that should be run. If none are specified all Checks for the Subreddit the Activity is in will be run'
            })
            .action(async (type, activityId, checkNames) => {
                const app = new App(program.opts());

                let a;
                if (type === 'comment') {
                    a = app.client.getComment(activityId);
                } else {
                    a = app.client.getSubmission(activityId);
                }
                // @ts-ignore
                const activity = await a.fetch();
                const sub = await activity.subreddit.display_name;
                await app.buildManagers([sub]);
                if (app.subManagers.length > 0) {
                    const manager = app.subManagers.find(x => x.subreddit.display_name === sub) as Manager;
                    await manager.runChecks(type === 'comment' ? 'Comment' : 'Submission', activity, checkNames);
                }
            });


        await program.parseAsync();

    } catch (err) {
        const logger = winston.loggers.get('default');
        if (err.name === 'StatusCodeError' && err.response !== undefined) {
            const authHeader = err.response.headers['www-authenticate'];
            if (authHeader !== undefined && authHeader.includes('insufficient_scope')) {
                logger.error('Reddit responded with a 403 insufficient_scope, did you choose the correct scopes?');
            }
        }
        debugger;
        console.log(err);
    }
}());
