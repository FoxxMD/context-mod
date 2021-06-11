import commander, {InvalidOptionArgumentError} from "commander";
import {argParseInt, parseBool} from "../util";

export const getOptions = (): commander.Option[] => {
    let options = [];

    const clientId = new commander.Option('-c, --clientId <id>', 'Client ID for your Reddit application (default: process.env.CLIENT_ID)')
        .default(process.env.CLIENT_ID);
    clientId.required = true;

    const clientSecret = new commander.Option('-e, --clientSecret <secret>', 'Client Secret for your Reddit application (default: process.env.CLIENT_SECRET)')
        .default(process.env.CLIENT_SECRET);
    clientSecret.required = true;

    const accessToken = new commander.Option('-a, --accessToken <token>', 'Access token retrieved from authenticating an account with your Reddit Application (default: process.env.ACCESS_TOKEN)')
        .default(process.env.ACCESS_TOKEN);
    accessToken.required = true;

    const refreshToken = new commander.Option('-r, --refreshToken <token>', 'Refresh token retrieved from authenticating an account with your Reddit Application (default: process.env.REFRESH_TOKEN)')
        .default(process.env.REFRESH_TOKEN);
    refreshToken.required = true;

    const subreddits = new commander.Option('-s, --subreddits <list...>', 'List of subreddits to run on. Bot will run on all subs it has access to if not defined')
        .default(process.env.SUBREDDITS || [], 'process.env.SUBREDDITS (comma-seperated)');

    const logDir = new commander.Option('-d, --logDir <dir>', 'Absolute path to directory to store rotated logs in')
        .default(process.env.LOG_DIR || `${process.cwd()}/logs`, 'process.env.LOG_DIR || process.cwd()/logs');

    const logLevel = new commander.Option('-l, --logLevel <level>', 'Log level')
        .default(process.env.LOG_LEVEL || 'info', 'process.env.LOG_LEVEL || info');

    const wikiConfig = new commander.Option('-w, --wikiConfig <path>', 'Relative url to contextbot wiki page EX https://reddit.com/r/subreddit/wiki/<path>')
        .default(process.env.WIKI_CONFIG || 'botconfig/contextbot', "process.env.WIKI_CONFIG || 'botconfig/contextbot'");

    const snooDebug = new commander.Option('--snooDebug', 'Set Snoowrap to debug')
        .argParser(parseBool)
        .default(process.env.SNOO_DEBUG || false, 'process.env.SNOO_DEBUG || false');

    const authorTTL = new commander.Option('--authorTTL <ms>', 'Set the TTL (ms) for the Author Activities shared cache')
        .argParser(argParseInt)
        .default(process.env.AUTHOR_TTL || 10000, 'process.env.AUTHOR_TTL || 10000');

    const heartbeat = new commander.Option('--heartbeat <s>', 'Interval, in seconds, between heartbeat logs. Set to 0 to disable')
        .argParser(argParseInt)
        //heartbeat.defaultValueDescription = 'process.env.HEARTBEAT || 300';
        .default(process.env.HEARTBEAT || 300, 'process.env.HEARTBEAT || 300');

    const apiRemaining = new commander.Option('--apiLimitWarning <remaining>', 'When API limit remaining (600/10min) is lower than this value log statements for limit will be raised to WARN level')
        .argParser(argParseInt)
        .default(process.env.API_REMAINING || 250, 'process.env.API_REMAINING || 250');

    const dryRun = new commander.Option('--dryRun', 'Set dryRun=true for all checks/actions on all subreddits (overrides any existing)')
        .argParser(parseBool)
        .default(process.env.DRYRUN || false, 'process.env.DRYRUN || false');

    const disableCache = new commander.Option('--disableCache', 'Disable caching for all subreddits')
        .argParser(parseBool)
        .default(process.env.DISABLE_CACHE || false, 'process.env.DISABLE_CACHE || false');


    options.push(dryRun);

    options = [
        clientId,
        clientSecret,
        accessToken,
        refreshToken,
        subreddits,
        logDir,
        logLevel,
        wikiConfig,
        snooDebug,
        authorTTL,
        heartbeat,
        apiRemaining,
        dryRun,
        disableCache
    ]


    return options;
}
