import commander, {InvalidOptionArgumentError} from "commander";
import {argParseInt, parseBool} from "../util";

export const clientId = new commander.Option('-i, --clientId <id>', 'Client ID for your Reddit application (default: process.env.CLIENT_ID)');

export const clientSecret = new commander.Option('-e, --clientSecret <secret>', 'Client Secret for your Reddit application (default: process.env.CLIENT_SECRET)');

export const redirectUri = new commander.Option('-u, --redirectUri <uri>', 'Redirect URI for your Reddit application (default: process.env.REDIRECT_URI)');

export const sessionSecret = new commander.Option('-t, --sessionSecret <secret>', 'Secret use to encrypt session id/data (default: process.env.SESSION_SECRET)');

export const createAccessTokenOption = () => new commander.Option('-a, --accessToken <token>', 'Access token retrieved from authenticating an account with your Reddit Application (default: process.env.ACCESS_TOKEN)');

export const createRefreshTokenOption = () => new commander.Option('-r, --refreshToken <token>', 'Refresh token retrieved from authenticating an account with your Reddit Application (default: process.env.REFRESH_TOKEN)');

export const subreddits = new commander.Option('-s, --subreddits <list...>', 'List of subreddits to run on. Bot will run on all subs it has access to if not defined (default: process.env.SUBREDDITS)');

export const logDir = new commander.Option('-d, --logDir [dir]', 'Absolute path to directory to store rotated logs in')
    .default(process.env.LOG_DIR || `${process.cwd()}/logs`, 'process.env.LOG_DIR || process.cwd()/logs');

export const logLevel = new commander.Option('-l, --logLevel <level>', 'Log level')
    .default(process.env.LOG_LEVEL || 'verbose', 'process.env.LOG_LEVEL || verbose');

export const wikiConfig = new commander.Option('-w, --wikiConfig <path>', 'Relative url to contextbot wiki page EX https://reddit.com/r/subreddit/wiki/<path>')
    .default(process.env.WIKI_CONFIG || 'botconfig/contextbot', "process.env.WIKI_CONFIG || 'botconfig/contextbot'");

export const snooDebug = new commander.Option('--snooDebug', `Set Snoowrap to debug. If undefined will be on if logLevel='debug' (default: process.env.SNOO_DEBUG)`)
    .argParser(parseBool);

export const authorTTL = new commander.Option('--authorTTL <ms>', 'Set the TTL (ms) for the Author Activities shared cache (default: process.env.AUTHOR_TTL || 60000)')
    .argParser(argParseInt);

export const caching = new commander.Option('--caching <provider>', `Set the caching provider to use. Options 'memory', 'redis', or 'none' to disable (default: process.env.CACHING || memory)`)
    .argParser(argParseInt);

export const heartbeat = new commander.Option('--heartbeat <s>', 'Interval, in seconds, between heartbeat checks. (default: process.env.HEARTBEAT || 300)')
    .argParser(argParseInt);

export const softLimit = new commander.Option('--softLimit <limit>', 'When API limit remaining (600/10min) is lower than this subreddits will have SLOW MODE enabled (default: process.env.SOFT_LIMIT || 250)')
    .argParser(argParseInt);

export const hardLimit = new commander.Option('--hardLimit <limit>', 'When API limit remaining (600/10min) is lower than this all subreddit polling will be paused until api limit reset (default: process.env.SOFT_LIMIT || 250)')
    .argParser(argParseInt);

export const dryRun = new commander.Option('--dryRun', 'Set dryRun=true for all checks/actions on all subreddits (overrides any existing)')
    .argParser(parseBool)
    .default(process.env.DRYRUN || false, 'process.env.DRYRUN || false');

export const checks = new commander.Option('-h, --checks <checkNames...>', 'An optional list of Checks, by name, that should be run. If none are specified all Checks for the Subreddit the Activity is in will be run');

export const proxy = new commander.Option('--proxy <proxyEndpoint>', 'Proxy Snoowrap requests through this endpoint (default: process.env.PROXY)');

export const operator = new commander.Option('--operator <name>', 'Username of the reddit user operating this application, used for displaying OP level info/actions in UI (default: process.env.OPERATOR)');

export const operatorDisplay = new commander.Option('--operatorDisplay <name>', 'An optional name to display who is operating this application in the UI (default: process.env.OPERATOR_DISPLAY || Anonymous)');

export const port = new commander.Option('-p, --port <port>', 'Port for web server to listen on (default: process.env.PORT || 8085)');

export const sharedMod = new commander.Option('-q, --shareMod', `If enabled then all subreddits using the default settings to poll "unmoderated" or "modqueue" will retrieve results from a shared request to /r/mod (default: process.env.SHARE_MOD || false)`)
    .argParser(parseBool);

export const operatorConfig = new commander.Option('-c, --operatorConfig <path>', 'An absolute path to a JSON file to load all parameters from (default: process.env.OPERATOR_CONFIG)');

export const getUniversalWebOptions = (): commander.Option[] => {
    return [
        clientId,
        clientSecret,
        createAccessTokenOption(),
        createRefreshTokenOption(),
        redirectUri,
        sessionSecret,
        subreddits,
        logDir,
        logLevel,
        wikiConfig,
        snooDebug,
        authorTTL,
        heartbeat,
        softLimit,
        hardLimit,
        dryRun,
        proxy,
        operator,
        operatorDisplay,
        port,
        sharedMod,
        operatorConfig,
    ];
}

export const getUniversalCLIOptions = (): commander.Option[] => {

    const at = createAccessTokenOption();
    at.required = true;

    const rt = createRefreshTokenOption();
    rt.required = true;

    return [
        clientId,
        clientSecret,
        at,
        rt,
        subreddits,
        logDir,
        logLevel,
        wikiConfig,
        snooDebug,
        authorTTL,
        heartbeat,
        softLimit,
        hardLimit,
        dryRun,
        proxy,
        sharedMod,
        operatorConfig,
    ]
}

export const addOptions = (com: commander.Command, options: commander.Option[]): commander.Command => {
    return options.reduce((c, opt) => c.addOption(opt), com);
}

// TODO
export const subredditConfig = new commander.Option('-f, --subredditsConfig <path>', 'An absolute path to a JSON file to load subreddit configs from');
