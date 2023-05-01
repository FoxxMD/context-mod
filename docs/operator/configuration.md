---
parent: Operator
nav_order: 3
---

# Configuration

The **Operator** configuration refers to configuration used configure to the actual application/bot. This is different
from the **Subreddit** configuration that is defined in each Subreddit's wiki and determines the rules/actions for
activities the Bot runs on.

**The full documentation** for all options in the operator configuration can be found [**here in the operator schema.**](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

# Table of Contents

* [Defining Configuration](#defining-configuration)
* [CLI Usage](#cli-usage)
* [Minimum Configuration](#minimum-configuration)
* [Bots](#bots)
* [Examples](#example-configurations)
  * [Minimum Config](#minimum-config)
  * [Using Config Overrides](#using-config-overrides)
* [Cache Configuration](#cache-configuration)
* [Database Configuration](#database-configuration)

# Defining Configuration

CM can be configured using **any or all** of the approaches below. **It is recommended to use FILE ([File Configuration](#file-configuration-recommended))**

Any values defined at a **lower-listed** level of configuration will override any values from a higher-listed
configuration.

* **ENV** -- Environment variables loaded from an [`.env`](https://github.com/toddbluhm/env-cmd) file (path may be
  specified with `--file` cli argument)
* **ENV** -- Any already existing environment variables (exported on command line/terminal profile/etc.)
* **FILE** -- Values specified in a YAML/JSON configuration file using the structure [in the schema](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)
  * When reading the **schema** if the variable is available at a level of configuration other than **FILE** it will be
    noted with the same symbol as above. The value shown is the default.
* **ARG** -- Values specified as CLI arguments to the program (see [CLI Usage](#cli-usage) below)

## File Configuration (Recommended)

Using a file has many benefits over using ARG or ENV:

* CM can automatically update your configuration
* CM can automatically add bots via the [CM OAuth Helper](addingBot.md#cm-oauth-helper-recommended)
* CM has a built-in configuration editor that can help you build and validate your configuration file
* File config is **required** if adding multiple bots to CM

### Specify File Location

By default CM will look for `config.yaml` or `config.json` in the `DATA_DIR` directory:

* [Local installation](installation.md#locally) -- `DATA_DIR` is the root of your installation directory (same folder as `package.json`)
* [Docker](installation.md#docker-recommended) -- `DATA_DIR` is at `/config` in the container

The `DATA_DIR` directory can be changed by passing `DATA_DIR` as an environmental variable EX `DATA_DIR=/path/to/directory`

The name of the config file can be changed by passing `OPERATOR_CONFIG` as an environmental variable:

* As filename -- `OPERATOR_CONFIG=myConfig.yaml` -> CM looks for `/path/to/directory/myConfig.yaml`
* As absolute path -- `OPERATOR_CONFIG=/a/path/myConfig.yaml` -> CM looks for `/a/path/myConfig.yaml`

[**Refer to the Operator Config File Schema for full documentation**](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

### Defining Multiple Bots or CM Instances

One ContextMod instance can

* Run multiple bots (multiple reddit accounts -- each as a bot)
* Connect to many other, independent, ContextMod instances

However, the default configuration (using **ENV/ARG**) assumes your intention is to run one bot (one reddit account) on one CM instance without these additional features. This is to make this mode of operation easier for users with this intention.

To take advantage of this additional features you **must** use a **FILE** configuration. Learn about how this works and how to configure this scenario in the [Architecture Documentation.](serverClientArchitecture.md)

## CLI Usage

Running CM from the command line is accomplished with the following command:

```bash

node src/index.js run

```

Run `node src/index.js run help` to get a list of available command line options (denoted by **ARG** above):

<details markdown="block">

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

# Minimum Configuration

The minimum configuration required to run CM assumes you have no bots and want to use CM to [add your first bot.](addingBot.md#cm-oauth-helper-recommended)

You will need have this information available:

* From [provision a reddit client](README.md#provisioning-a-reddit-client)
  * Client ID
  * Client Secret
  * Redirect URI (if different from default `http://localhost:8085/callback`)
* Operator Name -- username of the reddit account you want to use to administer CM with

See the [**example minimum configuration** below.](#minimum-config)

This configuration can also be **generated** by CM if you start CM with **no configuration defined** and visit the web interface.

# Bots

Configured using the `bots` top-level property. Bot configuration can override and specify many more options than are available at the operator-level. Many of these can also set the defaults for each subreddit the bot runs:

* Of the subreddits this bot moderates, specify a subset of subreddits to run or exclude from running
* default caching behavior
* control the soft/hard api usage limits
* Flow Control defaults
* Filter Criteria defaults
* default Polling behavior

[Full documentation for all bot instance options can be found in the schema.](https://json-schema.app/view/%23/%23%2Fdefinitions%2FBotInstanceJsonConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

## Adding A Bot

If you use the [CM OAuth Helper](addingBot.md#cm-oauth-helper-recommended) and it works successfully then the configuration for the Bot will be automatically added.

### Manually Adding a Bot

Add a new *object* to the `bots` property at the top-level of your configuration. If `bots` does not exist create it now.

Minimum information required for a valid bot:

* Client Id
* Client Secret
* Refresh Token
* Access Token

<details markdown="block">
<summary>Example</summary>

```yaml
operator:
  name: YourRedditUsername

bots:
  - name: u/MyRedditBot # name is optional but highly recommend for readability in both config and web interface
    credentials:
      reddit:
        clientId: f4b4df1c7b2
        clientSecret: 34v5q1c56ub
        accessToken: 34_f1w1v4
        refreshToken: p75_1c467b2

web:
  credentials:
    clientId: f4b4df1c7b2
    clientSecret: 34v5q1c56ub
    redirectUri: 'http://localhost:8085/callback'
```

</details>

# Web Client

Configured using the `web` top-level property. Allows specifying settings related to:

* UI port
* Database and caching connection, if different from global settings
* Session max age and secret
* Invite max age
* Connections to CM API instances (if using multiple)

[Full documentation for all web settings can be found in the schema.](https://json-schema.app/view/%23/%23%2Fproperties%2Fweb?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

# Example Configurations

## Minimum Config

Below are examples of the minimum required config to run the application using all three config approaches independently.

Using **FILE**

<details markdown="block">

See [Specify File Location](#specify-file-location) for where this file would be located.

YAML (`config.yaml`)

```yaml
operator:
  name: YourRedditUsername
web:
  credentials:
    clientId: f4b4df1c7b2
    clientSecret: 34v5q1c56ub
    redirectUri: 'http://localhost:8085/callback'
```

JSON (`config.json5`)

```json5
{
  "operator": {
    "name": "YourRedditUsername"
  },
  "web": {
    "credentials": {
      "clientId": "f4b4df1c7b2",
      "clientSecret": "34v5q1c56ub",
      "redirectUri": "http://localhost:8085/callback"
    }
  }
}
```

</details>

Using **ENV** (`.env`)

<details markdown="block">

```
OPERATOR=YourRedditUsername
CLIENT_ID=f4b4df1c7b2
CLIENT_SECRET=34v5q1c56ub
REDIRECT_URI=http://localhost:8085/callback
```

</details>

Using **ARG**

<details markdown="block">

```
node src/index.js run --clientId=f4b4df1c7b2 --clientSecret=34v5q1c56ub --redirectUri=http://localhost:8085/callback
```

</details>

## Using Config Overrides

An example of using multiple configuration levels together IE all are provided to the application:

**FILE**

<details markdown="block">

```json
{
  "logging": {
    "level": "debug"
  }
}
```

YAML

```yaml
logging:
  level: debug
```

</details>

**ENV** (`.env`)

<details markdown="block">

```
CLIENT_SECRET=34v5q1c56ub
SUBREDDITS=sub1,sub2,sub3
PORT=9008
```

</details>

**ARG**

<details markdown="block">

```
node src/index.js run --subreddits=sub1 --clientId=34v5q1c56ub
```

</details>

When all three are used together they produce these variables at runtime for the application:

```
clientId: f4b4df1c7b2
clientSecret: 34v5q1c56ub
subreddits: sub1
port: 9008
log level: debug
```

## Configuring Client for Many Instances

See the [Architecture Docs](erverClientArchitecture.md) for more information.

<details markdown="block">

YAML

```yaml
bots:
  - credentials:
      clientId: f4b4df1c7b2
      clientSecret: 34v5q1c56ub
      refreshToken: 34_f1w1v4
      accessToken: p75_1c467b2
web:
  credentials:
    clientId: f4b4df1c7b2
    clientSecret: 34v5q1c56ub
    redirectUri: 'http://localhost:8085/callback'
  clients:
      # server application running on this same CM instance
    - host: 'localhost:8095'
      secret: localSecret
      # a server application running somewhere else
    - host: 'mySecondContextMod.com:8095'
      secret: anotherSecret
api:
  secret: localSecret
```

JSON

```json5
{
  "bots": [
    {
      "credentials": {
        "clientId": "f4b4df1c7b2",
        "clientSecret": "34v5q1c56ub",
        "refreshToken": "34_f1w1v4",
        "accessToken": "p75_1c467b2"
      }
    }
  ],
  "web": {
    "credentials": {
      "clientId": "f4b4df1c7b2",
      "clientSecret": "34v5q1c56ub",
      "redirectUri": "http://localhost:8085/callback"
    },
    "clients": [
      // server application running on this same CM instance
      {
        "host": "localhost:8095",
        "secret": "localSecret"
      },
      // a server application running somewhere else
      {
        // api endpoint and port
        "host": "mySecondContextMod.com:8095",
        "secret": "anotherSecret"
      }
    ]
  },
  "api": {
    "secret": "localSecret",
  }
}
```

</details>

# Cache Configuration

See the [Cache Configuration](caching.md) documentation.

# Database Configuration

See the [Database Configuration](database.md) documentation.
