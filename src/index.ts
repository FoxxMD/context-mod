import winston from 'winston';
import 'winston-daily-rotate-file';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import tz from 'dayjs/plugin/timezone';
import dduration from 'dayjs/plugin/duration.js';
import relTime from 'dayjs/plugin/relativeTime.js';
import sameafter from 'dayjs/plugin/isSameOrAfter.js';
import samebefore from 'dayjs/plugin/isSameOrBefore.js';
import {Manager} from "./Subreddit/Manager";
import {Command, Argument} from 'commander';

import {
    addOptions,
    checks,
    getUniversalCLIOptions,
    getUniversalWebOptions,
    operatorConfig
} from "./Utils/CommandConfig";
import {App} from "./App";
import apiServer from './Web/Server/server';
import clientServer from './Web/Client';
import Submission from "snoowrap/dist/objects/Submission";
import {COMMENT_URL_ID, parseLinkIdentifier, SUBMISSION_URL_ID} from "./util";
import LoggedError from "./Utils/LoggedError";
import {buildOperatorConfigWithDefaults, parseOperatorConfigFromSources} from "./ConfigBuilder";
import {getLogger} from "./Utils/loggerFactory";
import Bot from "./Bot";
import {isScopeError} from "./Utils/Errors";

dayjs.extend(utc);
dayjs.extend(dduration);
dayjs.extend(relTime);
dayjs.extend(sameafter);
dayjs.extend(samebefore);
dayjs.extend(tz);
dayjs.extend(advancedFormat);

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

const preRunCmd = new Command();
preRunCmd.addOption(operatorConfig);
preRunCmd.allowUnknownOption();

const program = new Command();

(async function () {
    let app: App;
    // let errorReason: string | undefined;
    // process.on('SIGTERM', async () => {
    //     if(app !== undefined) {
    //         await app.onTerminate(errorReason);
    //     }
    //     process.exit(errorReason === undefined ? 0 : 1);
    // });
    try {

        let runCommand = program
            .command('run')
            .addArgument(new Argument('[interface]', 'Which interface to start the bot with').choices(['client', 'server', 'all']).default(undefined, 'process.env.MODE || all'))
            .description('Monitor new activities from configured subreddits.')
            .allowUnknownOption();
        runCommand = addOptions(runCommand, getUniversalWebOptions());
        runCommand.action(async (interfaceVal, opts) => {
            const config = buildOperatorConfigWithDefaults(await parseOperatorConfigFromSources({...opts, mode: interfaceVal}));
            const {
                mode,
            } = config;
            try {
                if(mode === 'all' || mode === 'client') {
                    await clientServer(config);
                }
                if(mode === 'all' || mode === 'server') {
                    await apiServer(config);
                }
            } catch (err) {
                throw err;
            }
        });

        let checkCommand = program
            .command('check <activityIdentifier> [type] [bot]')
            .allowUnknownOption()
            .description('Run check(s) on a specific activity', {
                activityIdentifier: 'Either a permalink URL or the ID of the Comment or Submission',
                type: `If activityIdentifier is not a permalink URL then the type of activity ('comment' or 'submission'). May also specify 'submission' type when using a permalink to a comment to get the Submission`,
                bot: 'Specify the bot to try with using `bot.name` (from config) -- otherwise all bots will be built before the bot to be used can be determined'
            });
        checkCommand = addOptions(checkCommand, getUniversalCLIOptions());
        checkCommand
            .addOption(checks)
            .action(async (activityIdentifier, type, botVal, commandOptions = {}) => {
                const config = buildOperatorConfigWithDefaults(await parseOperatorConfigFromSources(commandOptions));
                const {checks = []} = commandOptions;
                app = new App(config);

                let a;
                const commentId = commentReg(activityIdentifier);
                if (commentId !== undefined) {
                    if (type !== 'submission') {
                        // @ts-ignore
                        a = await app.client.getComment(commentId);
                    } else {
                        // @ts-ignore
                        a = await app.client.getSubmission(submissionReg(activityIdentifier) as string);
                    }
                }
                if (a === undefined) {
                    const submissionId = submissionReg(activityIdentifier);
                    if (submissionId !== undefined) {
                        if (type === 'comment') {
                            throw new Error(`Detected URL was for a submission but type was 'comment', cannot get activity`);
                        } else {
                            // @ts-ignore
                            a = await app.client.getSubmission(submissionId);
                        }
                    }
                }

                if (a === undefined) {
                    // if we get this far then probably not a URL
                    if (type === undefined) {
                        throw new Error(`activityIdentifier was not a valid Reddit URL and type was not specified`);
                    }
                    if (type === 'comment') {
                        // @ts-ignore
                        a = await app.client.getComment(activityIdentifier);
                    } else {
                        // @ts-ignore
                        a = await app.client.getSubmission(activityIdentifier);
                    }
                }

                // @ts-ignore
                const activity = await a.fetch();
                const sub = await activity.subreddit.display_name;
                const logger = winston.loggers.get('app');
                let bots: Bot[] = [];
                if(botVal !== undefined) {
                    const bot = app.bots.find(x => x.botName === botVal);
                    if(bot === undefined) {
                        logger.error(`No bot named "${botVal} found"`);
                    } else {
                        bots = [bot];
                    }
                } else  {
                    bots = app.bots;
                }
                for(const b of bots) {
                    await b.buildManagers([sub]);
                    if(b.subManagers.length > 0) {
                       const manager = b.subManagers[0];
                        await manager.runChecks(type === 'comment' ? 'Comment' : 'Submission', activity, {checkNames: checks});
                        break;
                    }
                }
            });

        let unmodCommand = program.command('unmoderated <subreddits...>')
            .description('Run checks on all unmoderated activity in the modqueue', {
                subreddits: 'The list of subreddits to run on. If not specified will run on all subreddits the account has moderation access to.',
                bot: 'Specify the bot to try with using `bot.name` (from config) -- otherwise all bots will be built before the bot to be used can be determined'
            })
            .allowUnknownOption();
        unmodCommand = addOptions(unmodCommand, getUniversalCLIOptions());
        unmodCommand
            .addOption(checks)
            .action(async (subreddits = [], botVal, opts = {}) => {
                const config = buildOperatorConfigWithDefaults(await parseOperatorConfigFromSources(opts));
                const {checks = []} = opts;
                const logger = winston.loggers.get('app');
                let bots: Bot[] = [];
                if(botVal !== undefined) {
                    const bot = app.bots.find(x => x.botName === botVal);
                    if(bot === undefined) {
                        logger.error(`No bot named "${botVal} found"`);
                    } else {
                        bots = [bot];
                    }
                } else  {
                    bots = app.bots;
                }
                for(const b of bots) {
                    await b.buildManagers(subreddits);
                    for(const manager of b.subManagers) {
                        const activities = await manager.subreddit.getUnmoderated();
                        for (const a of activities.reverse()) {
                            manager.firehose.push({
                                checkType: a instanceof Submission ? 'Submission' : 'Comment',
                                activity: a,
                                options: {checkNames: checks}
                            });
                        }
                    }
                }
            });

        await program.parseAsync();

    } catch (err) {
        if (!err.logged && !(err instanceof LoggedError)) {
            const logger = winston.loggers.get('app');
            if(isScopeError(err)) {
                logger.error('Reddit responded with a 403 insufficient_scope which means the bot is lacking necessary OAUTH scopes to perform general actions.');
            }
            logger.error(err);
        }
        process.kill(process.pid, 'SIGTERM');
    }
}());
export {Author} from "./Author/Author";
export {AuthorCriteria} from "./Author/Author";
export {AuthorOptions} from "./Author/Author";
