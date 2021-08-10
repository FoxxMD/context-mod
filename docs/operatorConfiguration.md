The **Operator** configuration refers to configuration used configure to the actual application/bot. This is different
from the **Subreddit** configuration that is defined in each Subreddit's wiki and determines the rules/actions for
activities the Bot runs on.

# Table of Contents

* [Minimum Required Configuration](#minimum-required-configuration)
* [Defining Configuration](#defining-configuration)
* [CLI Usage](#cli-usage)
* [Examples](#example-configurations)
  * [Minimum Config](#minimum-config)
  * [Using Config Overrides](#using-config-overrides)
* [Cache Configuration](#cache-configuration)

# Minimum Required Configuration

| property       | Bot Authentication | API And Web        | API Only           | Web Only           |
|:--------------:|:------------------:|:------------------:|:------------------:|:------------------:|
| `clientId`     | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: |
| `clientSecret` | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: |
| `redirectUri`  | :x:                | :heavy_check_mark: | :x:                | :heavy_check_mark: |
| `refreshToken` | :x:                | :heavy_check_mark: | :heavy_check_mark: | :x:                |
| `accessToken`  | :x:                | :heavy_check_mark: | :heavy_check_mark: | :x:                |

Refer to the **[Bot Authentication guide](/docs/botAuthentication.md)** to retrieve credentials.

# Defining Configuration

CM can be configured using **any or all** of the approaches below. Note that **at each level ALL configuration values are
optional** but the "required configuration" mentioned above must be available when all levels are combined.

Any values defined at a **lower-listed** level of configuration will override any values from a higher-listed
configuration.

* **ENV** -- Environment variables loaded from an [`.env`](https://github.com/toddbluhm/env-cmd) file (path may be
  specified with `--file` cli argument)
* **ENV** -- Any already existing environment variables (exported on command line/terminal profile/etc.)
* **FILE** -- Values specified in a JSON configuration file using the structure [in the schema](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)
* **ARG** -- Values specified as CLI arguments to the program (see [ClI Usage](#cli-usage) below)

**Note:** When reading the **schema** if the variable is available at a level of configuration other than **FILE** it will be
noted with the same symbol as above. The value shown is the default.

* To load a JSON configuration (for **FILE**) **from the command line** use the `-c` cli argument EX: `node src/index.js -c /path/to/JSON/config.json`
* To load a JSON configuration (for **FILE**) **using an environmental variable** use `OPERATOR_CONFIG` EX: `OPERATOR_CONFIG=/path/to/JSON/config.json`

[**See the Operator Config Schema here**](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

## CLI Usage

Running CM from the command line is accomplished with the following command:

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
  --operator <name...>          Username(s) of the reddit user(s) operating this application, used for displaying OP level info/actions in UI (default: process.env.OPERATOR)
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

An example of using multiple configuration levels together IE all are provided to the application:

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

When all three are used together they produce these variables at runtime for the application:

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

CM implements two caching backend **providers**. By default all providers use `memory`:

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
