# reddit-context-bot

[![Latest Release](https://img.shields.io/github/v/release/foxxmd/reddit-context-bot)](https://github.com/FoxxMD/reddit-context-bot/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker Pulls](https://img.shields.io/docker/pulls/foxxmd/reddit-context-bot)](https://hub.docker.com/r/foxxmd/reddit-context-bot)

**Context Bot** is an event-based, [reddit](https://reddit.com) moderation bot built on top of [snoowrap](https://github.com/not-an-aardvark/snoowrap) and written in [typescript](https://www.typescriptlang.org/).

It is designed to help fill in the gaps for [automoderator](https://www.reddit.com/wiki/automoderator/full-documentation) in regard to more complex behavior with a focus on **user-history based moderation.**

An example of the above that Context Bot can do now:

> * On a new submission, check if the user has also posted the same link in **N** number of other subreddits within a timeframe/# of posts
> * On a new submission or comment, check if the user has had any activity (sub/comment) in **N** set of subreddits within a timeframe/# of posts
>
>In either instance Context Bot can then perform any action a moderator can (comment, report, remove, lock, etc...) against that user, comment, or submission.

Some feature highlights:
* Simple rule-action behavior can be combined to create any level of complexity in behavior
* One instance can handle managing many subreddits (as many as it has moderator permissions in!)
* Per-subreddit configuration is handled by JSON stored in the subreddit wiki
* Any text-based actions (comment, submission, message, usernotes, etc...) can be configured via a wiki page or raw text in JSON
* All text-based actions support [mustache](https://mustache.github.io) templating
* History-based rules support multiple "valid window" types -- [ISO 8601 Durations](https://en.wikipedia.org/wiki/ISO_8601#Durations), [Day.js Durations](https://day.js.org/docs/en/durations/creating), and submission/comment count limits.
* Checks/Rules support skipping behavior based on:
  * author criteria (name, css flair/text, moderator status, and [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes))
  * Activity state (removed, locked, distinguished, etc.)
* Rules and Actions support named references so you write rules/actions once and reference them anywhere
* User-configurable global/subreddit-level API caching
* Support for [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) as criteria or Actions (writing notes)
* Docker container support

# Table of Contents

* [How It Works](#how-it-works)
* [Installation](#installation)
* [Configuration And Docs](#configuration)
* [Usage](#usage)

### How It Works

Context Bot's configuration is made up of a list of **Checks**. Each **Check** consists of :

#### Kind

Is this check for a submission or comment?

#### Rules

A list of **Rule** objects to run against the activity. Triggered Rules can cause the whole Check to trigger and run its **Actions**

#### Actions

A list of **Action** objects that describe what the bot should do with the activity or author of the activity. The bot will run **all** Actions in this list.

___

The **Checks** for a subreddit are split up into **Submission Checks** and **Comment Checks** based on their **kind**. Each list of checks is run independently based on when events happen (submission or comment).

When an event occurs all Checks of that type are run in the order they were listed in the configuration. When one check is triggered (an action is performed) the remaining checks will not be run.

## Installation


### Locally

Clone this repository somewhere and then install from the working directory

```bash
git clone https://github.com/FoxxMD/reddit-context-bot.git .
cd reddit-context-bot
npm install
```

### [Docker](https://hub.docker.com/r/foxxmd/reddit-context-bot)

```
foxxmd/reddit-context-bot:latest
```

Adding [**environmental variables**](#usage) to your `docker run` command will pass them through to the app EX:
```
docker run -e "CLIENT_ID=myId" ... foxxmd/reddit-context-bot
```

### [Heroku Quick Deploy](https://heroku.com/about)
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://dashboard.heroku.com/new?template=https://github.com/FoxxMD/reddit-context-bot)


## Configuration

[**Check the docs for in-depth explanations of all concepts and examples**](/docs)

Context Bot's configuration can be written in JSON, [JSON5](https://json5.org/) or YAML. It's [schema](/src/Schema/App.json) conforms to [JSON Schema Draft 7](https://json-schema.org/).

I suggest using [Atlassian JSON Schema Viewer](https://json-schema.app/start) ([direct link](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)) so you can view all documentation while also interactively writing and validating your config! From there you can drill down into any object, see its requirements, view an example JSON document, and live-edit your configuration on the right-hand side.

### Action Templating

Actions that can submit text (Report, Comment) will have their `content` values run through a [Mustache Template](https://mustache.github.io/). This means you can insert data generated by Rules into your text before the Action is performed.

See here for a [cheatsheet](https://gist.github.com/FoxxMD/d365707cf99fdb526a504b8b833a5b78) and [here](https://www.tsmean.com/articles/mustache/the-ultimate-mustache-tutorial/) for a more thorough tutorial.

All Actions with `content` have access to this data:

```json5
{
    item: {
        kind: 'string', // the type of item (comment/submission)
        author: 'string', // name of the item author (reddit user)
        permalink: 'string', // a url to the item
        url: 'string', // if the item is a Submission then its URL (external for link type submission, reddit link for self-posts)
        title: 'string', // if the item is a Submission, then the title of the Submission,
        botLink: 'string' // a link to the bot's FAQ
    },
    rules: {
        // contains all rules that were run and are accessible using the name, lowercased, with all spaces/dashes/underscores removed
    }
}

```

The properties of `rules` are accessible using the name, lower-cased, with all spaces/dashes/underscores. If no name is given `kind` is used as `name` Example:

```
"rules": [
  {
    "name": "My Custom-Recent Activity Rule", // mycustomrecentactivityrule
    "kind": "recentActivity"
  },
  {
    // name = repeatsubmission
    "kind": "repeatActivity",
  }
]
```

**To see what data is available for individual Rules [consult the schema](#configuration) for each Rule.**

#### Quick Templating Tutorial

<details>

As a quick example for how you will most likely be using templating -- wrapping a variable in curly brackets, `{{variable}}`, will cause the variable value to be rendered instead of the brackets:
```
myVariable = 50;
myOtherVariable = "a text fragment"
template = "This is my template, the variable is {{myVariable}}, my other variable is {{myOtherVariable}}, and that's it!";

console.log(Mustache.render(template, {myVariable});
// will render...
"This is my template, the variable is 50, my other variable is a text fragment, and that's it!";
```

**Note: When accessing an object or its properties you must use dot notation**
```
const item = {
aProperty: 'something',
anotherObject: {
bProperty: 'something else'
}
}
const content = "My content will render the property {{item.aProperty}} like this, and another nested property {{item.anotherObject.bProperty}} like this."
```
</details>

## Usage

```
Usage: index [options] [command]

Options:
  -c, --clientId <id>                          Client ID for your Reddit application (default: process.env.CLIENT_ID)
  -e, --clientSecret <secret>                  Client Secret for your Reddit application (default: process.env.CLIENT_SECRET)
  -a, --accessToken <token>                    Access token retrieved from authenticating an account with your Reddit Application (default: process.env.ACCESS_TOKEN)
  -r, --refreshToken <token>                   Refresh token retrieved from authenticating an account with your Reddit Application (default: process.env.REFRESH_TOKEN)
  -s, --subreddits <list...>                   List of subreddits to run on. Bot will run on all subs it has access to if not defined (default: process.env.SUBREDDITS (comma-seperated))
  -d, --logDir <dir>                           Absolute path to directory to store rotated logs in (default: process.env.LOG_DIR || process.cwd()/logs)
  -l, --logLevel <level>                       Log level (default: process.env.LOG_LEVEL || info)
  -w, --wikiConfig <path>                      Relative url to contextbot wiki page EX https://reddit.com/r/subreddit/wiki/<path> (default: process.env.WIKI_CONFIG || 'botconfig/contextbot')
  --snooDebug                                  Set Snoowrap to debug (default: process.env.SNOO_DEBUG || false)
  --authorTTL <ms>                             Set the TTL (ms) for the Author Activities shared cache (default: process.env.AUTHOR_TTL || 10000)
  --heartbeat <s>                              Interval, in seconds, between heartbeat logs. Set to 0 to disable (default: process.env.HEARTBEAT || 300)
  --apiLimitWarning <remaining>                When API limit remaining (600/10min) is lower than this value log statements for limit will be raised to WARN level (default: process.env.API_REMAINING || 250)
  --dryRun                                     Set dryRun=true for all checks/actions on all subreddits (overrides any existing) (default: process.env.DRYRUN)
  --disableCache                               Disable caching for all subreddits (default: process.env.DISABLE_CACHE || false)
  -h, --help                                   display help for command

Commands:
  run                                          Runs bot normally
  check [options] <activityIdentifier> [type]  Run check(s) on a specific activity
  unmoderated [options] <subreddits...>        Run checks on all unmoderated activity in the modqueue
  help [command]                               display help for command

```

### Logging

### Reddit App??

To use this bot you must do two things:
* Create a reddit application
* Authenticate that application to act as a user (login to the application with an account)

#### Create Application

Visit [your reddit preferences](https://www.reddit.com/prefs/apps) and at the bottom of the page go through the **create an(other) app** process.
* Choose **script**
* For redirect uri use https://not-an-aardvark.github.io/reddit-oauth-helper/
* Write down your **Client ID** and **Client Secret** somewhere

#### Authenticate an Account

Visit https://not-an-aardvark.github.io/reddit-oauth-helper/
* Input your **Client ID** and **Client Secret** in the text boxes with those names.
* Choose scopes. **It is very important you check everything on this list or Context Bot will not work correctly**
    * edit
    * flair
    * history
    * identity
    * modcontributors
    * modflair
    * modposts
    * modself
    * mysubreddits
    * read
    * report
    * submit
    * wikiread
    * wikiedit (if you are using Toolbox User Notes)
* Click **Generate tokens**, you will get a popup asking you to approve access (or login) -- **the account you approve access with is the account that Bot will control.**
* After approving an **Access Token** and **Refresh Token** will be shown at the bottom of the page. Write these down. 
  
You should now have all the information you need to start the bot.

## License

[MIT](/LICENSE)
