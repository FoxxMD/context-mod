"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const snoowrap_1 = __importDefault(require("snoowrap"));
const minimist_1 = __importDefault(require("minimist"));
const winston_1 = __importDefault(require("winston"));
require("winston-daily-rotate-file");
const dayjs_1 = __importDefault(require("dayjs"));
const utc_js_1 = __importDefault(require("dayjs/plugin/utc.js"));
const duration_js_1 = __importDefault(require("dayjs/plugin/duration.js"));
const util_1 = require("./util");
const ConfigBuilder_1 = require("./ConfigBuilder");
const events_1 = __importDefault(require("events"));
const Manager_1 = require("./Subreddit/Manager");
const p_event_1 = __importDefault(require("p-event"));
dayjs_1.default.extend(utc_js_1.default);
dayjs_1.default.extend(duration_js_1.default);
const { transports } = winston_1.default;
const argv = minimist_1.default(process.argv.slice(2));
const { _: subredditsArgs = [], clientId = process.env.CLIENT_ID, clientSecret = process.env.CLIENT_SECRET, accessToken = process.env.ACCESS_TOKEN, refreshToken = process.env.REFRESHTOKEN, logDir = process.env.LOG_DIR, logLevel = process.env.LOG_LEVEL, } = argv;
const logPath = logDir ?? `${process.cwd()}/logs`;
// @ts-ignore
const rotateTransport = new winston_1.default.transports.DailyRotateFile({
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
    format: util_1.labelledFormat(),
    transports: myTransports,
};
winston_1.default.loggers.add('default', loggerOptions);
const logger = winston_1.default.loggers.get('default');
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
        const client = new snoowrap_1.default(creds);
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
                const asub = availSubs.find(x => x.name.toLowerCase() === sub.trim().toLowerCase());
                if (asub === undefined) {
                    logger.error(`Will not run on ${sub} because is not modded by, or does not have appropriate permissions to mod with, for this client.`);
                }
                else {
                    subsToRun.push(asub);
                }
            }
        }
        else {
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
            }
            catch (err) {
                logger.error(`Could not read wiki configuration for ${sub.display_name}. Please ensure the page 'contextbot' exists and is readable -- error: ${err.message}`);
                continue;
            }
            try {
                json = JSON.parse(content);
            }
            catch (err) {
                logger.error(`Wiki page contents for ${sub.display_name} was not valid -- error: ${err.message}`);
                continue;
            }
            try {
                const builder = new ConfigBuilder_1.ConfigBuilder({ subreddit: sub });
                const [subChecks, commentChecks] = builder.buildFromJson(json);
                subSchedule.push(new Manager_1.Manager(sub, client, subChecks, commentChecks));
                logger.info(`[${sub.display_name}] Found ${subChecks.length} submission checks and ${commentChecks.length} comment checks`);
            }
            catch (err) {
                logger.error(`Config for ${sub.display_name} was not valid`);
            }
        }
        const emitter = new events_1.default();
        for (const manager of subSchedule) {
            manager.handle();
        }
        // never hits so we can run indefinitely
        await p_event_1.default(emitter, 'end');
    }());
}
catch (err) {
    debugger;
    console.log(err);
}
//# sourceMappingURL=index.js.map