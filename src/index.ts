import winston from 'winston';
import 'winston-daily-rotate-file';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
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
import createWebServer from './Web/Server/server';
import client from './Web/Client';
import createHelperServer from './Web/Server/helper';
import Submission from "snoowrap/dist/objects/Submission";
import {COMMENT_URL_ID, parseLinkIdentifier, SUBMISSION_URL_ID} from "./util";
import LoggedError from "./Utils/LoggedError";
import {getLogger} from "./Utils/loggerFactory";
import {buildOperatorConfigWithDefaults, parseOperatorConfigFromSources} from "./ConfigBuilder";

dayjs.extend(utc);
dayjs.extend(dduration);
dayjs.extend(relTime);
dayjs.extend(sameafter);
dayjs.extend(samebefore);

const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

const preRunCmd = new Command();
preRunCmd.addOption(operatorConfig);
preRunCmd.allowUnknownOption();

const program = new Command();

(async function () {
    let app: App;
    let errorReason: string | undefined;
    process.on('SIGTERM', async () => {
        if(app !== undefined) {
            await app.onTerminate(errorReason);
        }
        process.exit(errorReason === undefined ? 0 : 1);
    });
    try {

        let runCommand = program
            .command('run')
            .addArgument(new Argument('[interface]', 'Which interface to start the bot with').choices(['web', 'cli']).default(undefined, 'process.env.WEB || true'))
            .description('Monitor new activities from configured subreddits.')
            .allowUnknownOption();
        runCommand = addOptions(runCommand, getUniversalWebOptions());
        runCommand.action(async (interfaceVal, opts) => {
            const config = buildOperatorConfigWithDefaults(await parseOperatorConfigFromSources({...opts, web: interfaceVal !== undefined ? interfaceVal === 'web': undefined}));
            const {
                credentials: {
                    redirectUri,
                    clientId,
                    clientSecret,
                    accessToken,
                    refreshToken,
                },
                web: {
                    enabled: web,
                },
                logging,
            } = config;
            const logger = getLogger(logging, 'init');
            const hasClient = clientId !== undefined && clientSecret !== undefined;
            const hasNoTokens = accessToken === undefined && refreshToken === undefined;
            try {
                if (web) {
                    if (hasClient && hasNoTokens) {
                        // run web helper
                        const server = createHelperServer(config);
                        await server;
                    } else {
                        if (redirectUri === undefined) {
                            logger.warn(`No 'redirectUri' found in arg/env. Bot will still run but web interface will not be accessible.`);
                        }
                        const [server, bot] = createWebServer(config);
                        app = bot;

                        try {
                            await server();
                        } catch (e) {
                            throw e;
                        }
                        try {
                            await client(config);
                        } catch(e) {
                            throw e;
                        }

                        await bot.testClient();
                        await bot.buildManagers();

                        await bot.runManagers();
                    }
                } else {
                    app = new App(config);
                    await app.buildManagers();
                    await app.runManagers();
                }
            } catch (err) {
                throw err;
            }
        });

        let checkCommand = program
            .command('check <activityIdentifier> [type]')
            .allowUnknownOption()
            .description('Run check(s) on a specific activity', {
                activityIdentifier: 'Either a permalink URL or the ID of the Comment or Submission',
                type: `If activityIdentifier is not a permalink URL then the type of activity ('comment' or 'submission'). May also specify 'submission' type when using a permalink to a comment to get the Submission`,
            });
        checkCommand = addOptions(checkCommand, getUniversalCLIOptions());
        checkCommand
            .addOption(checks)
            .action(async (activityIdentifier, type, commandOptions = {}) => {
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
                await app.buildManagers([sub]);
                if (app.subManagers.length > 0) {
                    const manager = app.subManagers.find(x => x.subreddit.display_name === sub) as Manager;
                    await manager.runChecks(type === 'comment' ? 'Comment' : 'Submission', activity, {checkNames: checks});
                }
            });

        let unmodCommand = program.command('unmoderated <subreddits...>')
            .description('Run checks on all unmoderated activity in the modqueue', {
                subreddits: 'The list of subreddits to run on. If not specified will run on all subreddits the account has moderation access to.'
            })
            .allowUnknownOption();
        unmodCommand = addOptions(unmodCommand, getUniversalCLIOptions());
        unmodCommand
            .addOption(checks)
            .action(async (subreddits = [], opts = {}) => {
                const config = buildOperatorConfigWithDefaults(await parseOperatorConfigFromSources(opts));
                const {checks = []} = opts;
                const {subreddits: {names}} = config;
                app = new App(config);

                await app.buildManagers(names);

                for (const manager of app.subManagers) {
                    const activities = await manager.subreddit.getUnmoderated();
                    for (const a of activities.reverse()) {
                        manager.queue.push({
                            checkType: a instanceof Submission ? 'Submission' : 'Comment',
                            activity: a,
                            options: {checkNames: checks}
                        });
                    }
                }
            });

        await program.parseAsync();

    } catch (err) {
        if (!err.logged && !(err instanceof LoggedError)) {
            const logger = winston.loggers.get('default');
            if (err.name === 'StatusCodeError' && err.response !== undefined) {
                const authHeader = err.response.headers['www-authenticate'];
                if (authHeader !== undefined && authHeader.includes('insufficient_scope')) {
                    logger.error('Reddit responded with a 403 insufficient_scope, did you choose the correct scopes?');
                }
            }
            console.log(err);
        }
        errorReason = `Application crashed due to an uncaught error: ${err.message}`;
        process.kill(process.pid, 'SIGTERM');
    }
}());
export {Author} from "./Author/Author";
export {AuthorCriteria} from "./Author/Author";
export {AuthorOptions} from "./Author/Author";
