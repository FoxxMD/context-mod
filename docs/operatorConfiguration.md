The **Operator** configuration refers to configuration used configure to the actual application/bot. This is different
from the **Subreddit** configuration that is defined in each Subreddit's wiki and determines the rules/actions for
activities the Bot runs on.

# Table of Contents

* [Minimum Required Configuration](#minimum-required-configuration)
* [Defining Configuration](#defining-configuration)
* [Examples](#example-configurations)
  * [Minimum Config](#minimum-config)
  * [Using Config Overrides](#using-config-overrides)
* [Cache Configuration](#cache-configuration)

# Minimum Required Configuration

The minimum required configuration variables to run the bot on subreddits are:

* clientId
* clientSecret
* refreshToken
* accessToken

However, only **clientId** and **clientSecret** are required to run the **oauth helper** mode in order to generate the last two
configuration variables.

Refer to the **[Bot Autentication guide](/docs/botAuthentication.md)** to retrieve the above credentials.

# Defining Configuration

RCB can be configured using **any or all** of the approaches below. **At each level ALL configuration values are
optional** but some are required depending on the mode of operation for the application.

Any values defined at a **lower-listed** level of configuration will override any values from a higher-listed
configuration.

* **ENV** -- Environment variables loaded from an [`.env`](https://github.com/toddbluhm/env-cmd) file (path may be
  specified with `--file` cli argument)
* **ENV** -- Any already existing environment variables (exported on command line/terminal profile/etc.)
* **FILE** -- Values specified in a JSON configuration file using the structure shown below (TODO example json file)
* **ARG** -- Values specified as CLI arguments to the program (see [ClI Usage](#cli-usage) below)

In the below configuration, if the variable is available at a level of configuration other than **FILE** it will be
noted with the same symbol as above. The value shown is the default.

**NOTE:** To load a JSON configuration (for **FILE**) use the `-c` cli argument EX: `node src/index.js -c /path/to/JSON/config.json`

```js
const config = {
    operator: {
        // Username of the reddit user operating this application, used for displaying OP level info/actions in UI
        //
        // ENV => OPERATOR
        // ARG => --operator <name>
        name: undefined,
        // An optional name to display who is operating this application in the UI
        //
        // ENV => OPERATOR_DISPLAY
        // ARG => --operator <name>
        display: undefined,
    },
    // Values required to interact with Reddit's API
    credentials: {
        // Client ID for your Reddit application
        //
        // ENV => CLIENT_ID
        // ARG => --clientId <id>
        clientId: undefined,
        // Client Secret for your Reddit application
        //
        // ENV => CLIENT_SECRET
        // ARG => --clientSecret <secret>
        clientSecret: undefined,
        // Redirect URI for your Reddit application
        //
        // ENV => REDIRECT_URI
        // ARG => --redirectUri <uri>
        redirectUri: undefined,
        // Access token retrieved from authenticating an account with your Reddit Application
        //
        // ENV => ACCESS_TOKEN
        // ARG => --accessToken <token>
        accessToken: undefined,
        // Refresh token retrieved from authenticating an account with your Reddit Application 
        //
        // ENV => REFRESH_TOKEN
        // ARG => --refreshToken <token>
        refreshToken: undefined
    },
    logging: {
        // Minimum level to log at. 
        // Must be one of: error, warn, info, verbose, debug
        // 
        // ENV => LOG_LEVEL
        // ARG => --logLevel <level>
        level: 'verbose',
        // Absolute path to directory to store rotated logs in. 
        //
        // Leaving undefined disables rotating logs
        // Use ENV => true or ARG => --logDir to log to the current directory under /logs folder
        //
        // ENV => LOG_DIR
        // ARG => --logDir [dir]
        path: undefined,
    },
    snoowrap: {
        // Proxy endpoint to make Snoowrap requests to
        //
        // ENV => PROXY
        // ARG => --proxy <proxyEndpoint>
        proxy: undefined,
        // Set Snoowrap to log debug statements. If undefined will debug based on current log level
        //
        // ENV => SNOO_DEBUG
        // ARG => --snooDebug
        debug: false,
    },
    subreddits: {
        // Names of subreddits for bot to run on
        //
        // If undefined bot will run on all subreddits it is a moderated of
        //
        // ENV => SUBREDDITS (comma-separated)
        // ARG => --subreddits <list...>
        names: undefined,
        // If true set all subreddits in dry run mode, overriding configurations
        //
        // ENV => DRYRUN
        // ARG => --dryRun
        dryRun: false,
        // The default relative url to contextbot wiki page EX https://reddit.com/r/subreddit/wiki/<path>
        //
        // ENV => WIKI_CONFIG
        // ARG => --wikiConfig <path>
        wikiConfig: 'botconfig/contextbot',
        // Interval, in seconds, to perform application heartbeat
        //
        // ENV => HEARTBEAT
        // ARG => --heartbeat <sec>
        heartbeatInterval: 300,
    },
    polling: {
        // If set to true all subreddits polling unmoderated/modqueue with default polling settings will share a request to "r/mod"
        // otherwise each subreddit will poll its own mod view
        //
        // ENV => SHARE_MOD
        // ARG => --shareMod
        sharedMod: false,
        // Default interval, in seconds, to poll activity sources at
        interval: 30,
    },
    web: {
        // Whether the web server interface should be started
        // In most cases this does not need to be specified as the application will automatically detect if it is possible to start it --
        // use this to specify 'cli' if you encounter errors with port/address or are paranoid
        //
        // ENV => WEB
        // ARG => 'node src/index.js run [interface]' -- interface can be 'web' or 'cli'
        enabled: true,
        // Set the port for the web interface
        //
        // ENV => PORT
        // ARG => --port <number>
        port: 8085,
        session: {
            // The cache provider for sessions
            // can be 'memory', 'redis', or a custom config
            provider: 'memory',
            // The secret value used to encrypt session data
            // If provider is persistent (redis) specifying a value here will ensure sessions are valid between application restarts
            //
            // If undefined a random string is generated
            secret: undefined,
        },
        // The default log level to filter to in the web interface
        // If not specified will be same as application log level
        logLevel: undefined,
        // Maximum number of log statements to keep in memory for each subreddit
        maxLogs: 200,
    },
    caching: {
        // The default maximum age of cached data for an Author's history
        //
        // ENV => AUTHOR_TTL
        // ARG => --authorTTL <sec>
        authorTTL: 60,
        // The default maximum age of cached usernotes for a subreddit
        userNotesTTL: 300,
        // The default maximum age of cached content, retrieved from an external URL or subreddit wiki, used for comments/ban/footer
        wikiTTL: 300,
        // The cache provider used for caching reddit API responses and some internal results
        // can be 'memory', 'redis', or a custom config
        provider: 'memory'
    },
    api: {
        // The number of API requests remaining at which "slow mode" should be enabled
        //
        // ENV => SOFT_LIMT
        // ARG => --softLimit <limit>
        softLimit: 250,
        // The number of API requests remaining at at which all subreddit event polling should be paused
        //
        // ENV => HARD_LIMIT
        // ARG => --hardLimit <limit>
        hardLimit: 50,
    }
}
```

## CLI Usage

Running RCB from the command line is accomplished with the following command:

```bash

node src/index.js run

```

Run `node src/index.js run help` to get a list of available command line options (denoted by **ARG** above):

<details>

```
Usage: index [options] [command]

Options:
  -h, --help                                   display help for command

Commands:
  run [options] [interface]                    Monitor new activities from configured subreddits.
  check [options] <activityIdentifier> [type]  Run check(s) on a specific activity
  unmoderated [options] <subreddits...>        Run checks on all unmoderated activity in the modqueue
  help [command]                               display help for command


Options:
  -c, --operatorConfig <path>   An absolute path to a JSON file to load all parameters from (default: process.env.OPERATOR_CONFIG)
  -i, --clientId <id>           Client ID for your Reddit application (default: process.env.CLIENT_ID)
  -e, --clientSecret <secret>   Client Secret for your Reddit application (default: process.env.CLIENT_SECRET)
  -a, --accessToken <token>     Access token retrieved from authenticating an account with your Reddit Application (default: process.env.ACCESS_TOKEN)
  -r, --refreshToken <token>    Refresh token retrieved from authenticating an account with your Reddit Application (default: process.env.REFRESH_TOKEN)
  -u, --redirectUri <uri>       Redirect URI for your Reddit application (default: process.env.REDIRECT_URI)
  -t, --sessionSecret <secret>  Secret use to encrypt session id/data (default: process.env.SESSION_SECRET || a random string)
  -s, --subreddits <list...>    List of subreddits to run on. Bot will run on all subs it has access to if not defined (default: process.env.SUBREDDITS)
  -d, --logDir [dir]            Absolute path to directory to store rotated logs in. Leaving undefined disables rotating logs (default: process.env.LOG_DIR)
  -l, --logLevel <level>        Minimum level to log at (default: process.env.LOG_LEVEL || verbose)
  -w, --wikiConfig <path>       Relative url to contextbot wiki page EX https://reddit.com/r/subreddit/wiki/<path> (default: process.env.WIKI_CONFIG || 'botconfig/contextbot')
  --snooDebug                   Set Snoowrap to debug. If undefined will be on if logLevel='debug' (default: process.env.SNOO_DEBUG)
  --authorTTL <s>               Set the TTL (seconds) for the Author Activities shared cache (default: process.env.AUTHOR_TTL || 60)
  --heartbeat <s>               Interval, in seconds, between heartbeat checks. (default: process.env.HEARTBEAT || 300)
  --softLimit <limit>           When API limit remaining (600/10min) is lower than this subreddits will have SLOW MODE enabled (default: process.env.SOFT_LIMIT || 250)
  --hardLimit <limit>           When API limit remaining (600/10min) is lower than this all subreddit polling will be paused until api limit reset (default: process.env.SOFT_LIMIT || 250)
  --dryRun                      Set all subreddits in dry run mode, overriding configurations (default: process.env.DRYRUN || false)
  --proxy <proxyEndpoint>       Proxy Snoowrap requests through this endpoint (default: process.env.PROXY)
  --operator <name>             Username of the reddit user operating this application, used for displaying OP level info/actions in UI (default: process.env.OPERATOR)
  --operatorDisplay <name>      An optional name to display who is operating this application in the UI (default: process.env.OPERATOR_DISPLAY || Anonymous)
  -p, --port <port>             Port for web server to listen on (default: process.env.PORT || 8085)
  -q, --shareMod                If enabled then all subreddits using the default settings to poll "unmoderated" or "modqueue" will retrieve results from a shared request to /r/mod (default: process.env.SHARE_MOD || false)
  -h, --help                    display help for command
```

</details>

# Example Configurations

## Minimum Config

Below are examples of the minimum required config to run the application using all three config approaches independently.

Using **FILE**
<details>

```json
{
  "credentials": {
    "clientId": "f4b4df1c7b2",
    "clientSecret": "34v5q1c56ub",
    "refreshToken": "34_f1w1v4",
    "accessToken": "p75_1c467b2"
  }
}
```

</details>

Using **ENV** (`.env`)

<details>

```
CLIENT_ID=f4b4df1c7b2
CLIENT_SECRET=34v5q1c56ub
REFRESH_TOKEN=34_f1w1v4
ACCESS_TOKEN=p75_1c467b2
```

</details>

Using **ARG**

<details>

```
node src/index.js run --clientId=f4b4df1c7b2 --clientSecret=34v5q1c56ub --refreshToken=34_f1w1v4 --accessToken=p75_1c467b2
```

</details>

## Using Config Overrides

Using all three configs together:

**FILE**
<details>

```json
{
  "credentials": {
    "clientId": "f4b4df1c7b2",
    "refreshToken": "34_f1w1v4",
    "accessToken": "p75_1c467b2"
  }
}
```

</details>

**ENV** (`.env`)

<details>

```
CLIENT_SECRET=34v5q1c56ub
SUBREDDITS=sub1,sub2,sub3
PORT=9008
LOG_LEVEL=DEBUG
```

</details>

**ARG**

<details>

```
node src/index.js run --subreddits=sub1
```

</details>

Produces these variables at runtime for the application:

```
clientId: f4b4df1c7b2
clientSecret: 34v5q1c56ub
refreshToken: 34_f1w1v4
accessToken: accessToken
subreddits: sub1
port: 9008
log level: debug
```

# Cache Configuration

RCB implements two caching backend **providers**. By default all providers use `memory`:

* `memory` -- in-memory (non-persistent) backend
* `redis` -- [Redis](https://redis.io/) backend

Each `provider` object in configuration can be specified as:

* one of the above **strings** to use the **defaults settings** or
* an **object** with keys to override default settings

A caching object in the json configuration:

```json5
{
 "provider": {
   "store": "memory", // one of "memory" or "redis"
   "ttl": 60, // the default max age of a key in seconds
   "max": 500, // the maximum number of keys in the cache (for "memory" only)
   
   // the below properties only apply to 'redis' provider
   "host": 'localhost',
   "port": 6379,
   "auth_pass": null,
   "db": 0,
 }
}
```
