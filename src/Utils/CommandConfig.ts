import {Option} from "commander";

export const getOptions = () => {
    const options = [];

    const clientIdOption = new Option('-c, --clientId <id>', 'Client ID for your Reddit application').default(process.env.CLIENT_ID, 'process.env.CLIENT_ID');
    clientIdOption.required = true;
    options.push(clientIdOption);

    const clientSecretOption = new Option('-e, --clientSecret <secret>', 'Client Secret for your Reddit application').default(process.env.CLIENT_SECRET, 'process.env.CLIENT_SECRET');
    clientSecretOption.required = true;
    options.push(clientSecretOption);
    const accessTokenOption = new Option('-a, --accessToken <token>', 'Access token retrieved from authenticating an account with your Reddit Application').default(process.env.ACCESS_TOKEN, 'process.env.ACCESS_TOKEN');
    accessTokenOption.required = true;
    options.push(accessTokenOption);
    const refreshTokenOption = new Option('-r, --refreshToken <token>', 'Refresh token retrieved from authenticating an account with your Reddit Application').default(process.env.REFRESH_TOKEN, 'process.env.REFRESH_TOKEN');
    refreshTokenOption.required = true;
    options.push(refreshTokenOption);

    options.push(new Option('-s, --subreddits <list...>', 'List of subreddits to run on. Bot will run on all subs it has access to if not defined').default(process.env.SUBREDDITS || [], 'process.env.SUBREDDITS (comma-seperated)'));
    options.push(new Option('-d, --logDir <dir>', 'Absolute path to directory to store rotated logs in').default(process.env.LOG_DIR || `${process.cwd()}/logs`, 'process.env.LOG_DIR'));
    options.push(new Option('-l, --logLevel <level>', 'Log level').default(process.env.LOG_LEVEL, 'process.env.LOG_LEVEL'));
    options.push(new Option('-w, --wikiConfig <path>', 'Relative url to contextbot wiki page (from https://reddit.com/r/subreddit/wiki/<path>').default(process.env.WIKI_CONFIG || 'botconfig/contextbot', 'process.env.WIKI_CONFIG || \'botconfig/contextbot\''));
    options.push(new Option('--snooDebug', 'Set Snoowrap to debug').default(undefined, 'process.env.SNOO_DEBUG'));
    options.push(new Option('--authorTTL <ms>', 'Set the TTL (ms) for the Author Activities shared cache').default(process.env.AUTHOR_TTL || 10000, 'process.env.AUTHOR_TTL || 10000'));
    options.push(new Option('--disableCache', 'Disable caching for all subreddits'));
    options.push(new Option('--dryRun', 'Set dryRun=true for all checks/actions on all subreddits (overrides any existing)').default(undefined, 'process.env.DRYRUN'));

    return options;
}
