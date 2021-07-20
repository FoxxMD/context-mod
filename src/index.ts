import winston from 'winston';
import 'winston-daily-rotate-file';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import dduration from 'dayjs/plugin/duration.js';
import relTime from 'dayjs/plugin/relativeTime.js';
import sameafter from 'dayjs/plugin/isSameOrAfter.js';
import samebefore from 'dayjs/plugin/isSameOrBefore.js';
import {Manager} from "./Subreddit/Manager";
import {Command} from 'commander';
import {
    addOptions,
    checks,
    getUniversalCLIOptions,
    getUniversalWebOptions,
    limit,
    operatorConfig
} from "./Utils/CommandConfig";
import {App} from "./App";
import createWebServer from './Server/server';
import createHelperServer from './Server/helper';
import Submission from "snoowrap/dist/objects/Submission";
import {COMMENT_URL_ID, parseLinkIdentifier, SUBMISSION_URL_ID} from "./util";
import LoggedError from "./Utils/LoggedError";
import {getDefaultLogger} from "./Utils/loggerFactory";
import {GetEnvVars} from 'env-cmd';

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
    try {
        debugger;
        preRunCmd.parse(process.argv);
        const { operatorConfig = process.env.OPERATOR_CONFIG } = preRunCmd.opts();
        try {
            const vars = await GetEnvVars({
                envFile: {
                    filePath: operatorConfig,
                    fallback: true
                }
            });
            // if we found variables in the file of at a fallback path then add them in before we do main arg parsing
            for(const [k,v] of Object.entries(vars)) {
                // don't override existing
                if(process.env[k] === undefined) {
                    process.env[k] = v;
                }
            }
        } catch(err) {
            // mimicking --silent from env-cmd
            //swallow silently for now 😬
        }

        let runCommand = program
            .command('run')
            .description('Runs bot normally')
            .allowUnknownOption();
        runCommand = addOptions(runCommand, getUniversalCLIOptions());
        runCommand.action(async (opts) => {
            const app = new App(opts);
            await app.buildManagers();
            await app.runManagers();
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
                const {checks = []} = commandOptions;
                const app = new App(commandOptions);

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
            .addOption(limit)
            .action(async (subreddits = [], commandOptions = {}) => {
                const {checks = [], limit = 100} = commandOptions;
                const app = new App(commandOptions);

                await app.buildManagers(subreddits);

                for (const manager of app.subManagers) {
                    const activities = await manager.subreddit.getUnmoderated({limit});
                    for (const a of activities.reverse()) {
                        manager.queue.push({
                            checkType: a instanceof Submission ? 'Submission' : 'Comment',
                            activity: a,
                            options: {checkNames: checks}
                        });
                    }
                }
            });

        let webCommand = program.command('web')
            .allowUnknownOption();
        webCommand = addOptions(webCommand, getUniversalWebOptions());
        webCommand.action(async (opts) => {
            const {
                redirectUri = process.env.REDIRECT_URI,
                clientId = process.env.CLIENT_ID,
                clientSecret = process.env.CLIENT_SECRET,
                accessToken = process.env.ACCESS_TOKEN,
                refreshToken = process.env.REFRESH_TOKEN,
            } = opts;
            const hasClient = clientId !== undefined && clientSecret !== undefined;
            const hasNoTokens = accessToken === undefined && refreshToken === undefined;
            try {
                if (hasClient && hasNoTokens) {
                    // run web helper
                    const server = createHelperServer(opts);
                    await server;
                } else if (redirectUri === undefined) {
                    const logger = getDefaultLogger(opts);
                    logger.warn(`'web' command detected but no redirectUri found in arg/env. Switching to CLI only.`);
                    const app = new App(opts);
                    await app.buildManagers();
                    await app.runManagers();
                } else {
                    const server = createWebServer(opts);
                    await server;
                }
            } catch (err) {
                throw err;
            }
        });

        await program.parseAsync();

    } catch (err) {
        debugger;
        if(!err.logged && !(err instanceof LoggedError)) {
            const logger = winston.loggers.get('default');
            if (err.name === 'StatusCodeError' && err.response !== undefined) {
                const authHeader = err.response.headers['www-authenticate'];
                if (authHeader !== undefined && authHeader.includes('insufficient_scope')) {
                    logger.error('Reddit responded with a 403 insufficient_scope, did you choose the correct scopes?');
                }
            }
            console.log(err);
        }
        process.kill(process.pid, 'SIGTERM');
    }
}());
export {Author} from "./Author/Author";
export {AuthorCriteria} from "./Author/Author";
export {AuthorOptions} from "./Author/Author";
