import {InboxStream, CommentStream, SubmissionStream} from "snoostorm";
import snoowrap from "snoowrap";
import minimist from 'minimist';
import winston from 'winston';
import 'winston-daily-rotate-file';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import dduration from 'dayjs/plugin/duration.js';
import {labelledFormat} from "./util";
import {ConfigBuilder} from "./ConfigBuilder";
import EventEmitter from "events";
import {Manager} from "./Subreddit/Manager";
import pEvent from "p-event";

dayjs.extend(utc);
dayjs.extend(dduration);

const {transports} = winston;

const argv = minimist(process.argv.slice(2));
const {
    _: subredditsArgs = [],
    clientId = process.env.CLIENT_ID,
    clientSecret = process.env.CLIENT_SECRET,
    accessToken = process.env.ACCESS_TOKEN,
    refreshToken = process.env.REFRESHTOKEN,
    logDir = process.env.LOG_DIR,
    logLevel = process.env.LOG_LEVEL,
} = argv;

const logPath = logDir ?? `${process.cwd()}/logs`;

// @ts-ignore
const rotateTransport = new winston.transports.DailyRotateFile({
    dirname: logPath,
    createSymlink: true,
    symlinkName: 'contextBot-current.log',
    filename: 'contextBot-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '5m'
});

const consoleTransport = new transports.Console();

const myTransports = [
    consoleTransport,
];

if (typeof logPath === 'string') {
    // @ts-ignore
    myTransports.push(rotateTransport);
}

const loggerOptions = {
    level: logLevel || 'info',
    format: labelledFormat(),
    transports: myTransports,
};

winston.loggers.add('default', loggerOptions);

const logger = winston.loggers.get('default');

let subredditsArg = subredditsArgs;
if (subredditsArg.length === 0) {
    // try to get from comma delim env variable
    const subenv = process.env.SUBREDDITS;
    if (typeof subenv === 'string') {
        subredditsArg = subenv.split(',');
    }
}

try {
    (async function () {
        const creds = {
            userAgent: 'contextBot',
            clientId,
            clientSecret,
            refreshToken,
            accessToken,
        };
        const client = new snoowrap(creds);

        // const me = client.getMe().then(text => {
        //     console.log(text);
        // }).catch(err => {
        //     console.log(err);
        // })
        // const myName = me.name;

// determine which subreddits this account has appropriate access to
        let availSubs = [];
        for (const sub of await client.getModeratedSubreddits()) {
            // TODO don't know a way to check permissions yet
            availSubs.push(sub);
            // if(sub.user_is_moderator) {
            //     const modUser = sub.getModerators().find(x => x.name === myName);
            //     const canMod = modUser.features
            // }
        }

        let subsToRun = [];
// if user specified subs to run on check they are all subs client can mod
        if (subredditsArgs.length > 0) {
            for (const sub of subredditsArg) {
                const asub = availSubs.find(x => x.name.toLowerCase() === sub.trim().toLowerCase())
                if (asub === undefined) {
                    logger.error(`Will not run on ${sub} because is not modded by, or does not have appropriate permissions to mod with, for this client.`);
                } else {
                    subsToRun.push(asub);
                }
            }
        } else {
            // otherwise assume all moddable subs from client should be run on
            subsToRun = availSubs;
        }

        let subSchedule = [];

        // get configs for subs we want to run on and build/validate them
        for (const sub of subsToRun) {
            let content = undefined;
            let json = undefined;
            let config = undefined;
            try {
                const wiki = sub.getWikiPage('contextbot');
                content = await wiki.content_md;
            } catch (err) {
                logger.error(`Could not read wiki configuration for ${sub.display_name}. Please ensure the page 'contextbot' exists and is readable -- error: ${err.message}`);
                continue;
            }
            try {
                json = JSON.parse(content);

            } catch (err) {
                logger.error(`Wiki page contents for ${sub.display_name} was not valid -- error: ${err.message}`);
                continue;
            }
            try {
                const builder = new ConfigBuilder({subreddit: sub});
                const [subChecks, commentChecks] = builder.buildFromJson(json);
                subSchedule.push(new Manager(sub, client, subChecks, commentChecks));
                logger.info(`[${sub.display_name}] Found ${subChecks.length} submission checks and ${commentChecks.length} comment checks`);
            } catch (err) {
                logger.error(`Config for ${sub.display_name} was not valid`);
            }
        }

        const emitter = new EventEmitter();

        for(const manager of subSchedule) {
            manager.handle();
        }

        // never hits so we can run indefinitely
        await pEvent(emitter, 'end');
    }());
} catch (err) {
    debugger;
    console.log(err);
}
