# ContextMod [![Latest Release](https://img.shields.io/github/v/release/foxxmd/context-mod)](https://github.com/FoxxMD/context-mod/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Docker Pulls](https://img.shields.io/docker/pulls/foxxmd/context-mod)](https://hub.docker.com/r/foxxmd/context-mod)

<img src="/docs/logo.png" align="right"
alt="ContextMod logo" width="180" height="176">

**Context Mod** (CM) is an event-based, [reddit](https://reddit.com) moderation bot built on top of [snoowrap](https://github.com/not-an-aardvark/snoowrap) and written in [typescript](https://www.typescriptlang.org/).

It is designed to help fill in the gaps for [automoderator](https://www.reddit.com/wiki/automoderator/full-documentation) in regard to more complex behavior with a focus on **user-history based moderation.**

An example of the above that Context Bot can do now:

> * On a new submission, check if the user has also posted the same link in **N** number of other subreddits within a timeframe/# of posts
> * On a new submission or comment, check if the user has had any activity (sub/comment) in **N** set of subreddits within a timeframe/# of posts
>
>In either instance Context Bot can then perform any action a moderator can (comment, report, remove, lock, etc...) against that user, comment, or submission.

Some feature highlights:
* Simple rule-action behavior can be combined to create any level of complexity in behavior
* Server/client architecture
  * Default/no configuration runs "All In One" behavior
  * Additional configuration allows web interface to connect to multiple servers
  * Each server instance can run multiple reddit accounts as bots
* **Per-subreddit configuration** is handled by YAML (**like automoderator!**) or JSON stored in the subreddit wiki
* Any text-based actions (comment, submission, message, usernotes, ban, etc...) can be configured via a wiki page or raw text and supports [mustache](https://mustache.github.io) [templating](/docs/actionTemplating.md)
* History-based rules support multiple "valid window" types -- [ISO 8601 Durations](https://en.wikipedia.org/wiki/ISO_8601#Durations), [Day.js Durations](https://day.js.org/docs/en/durations/creating), and submission/comment count limits.
* Support Activity skipping based on:
  * Author criteria (name, css flair/text, age, karma, moderator status, and [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes))
  * Activity state (removed, locked, distinguished, etc.)
* Rules and Actions support named references (write once, reference anywhere)
* [**Image Comparisons**](/docs/imageComparison.md) via fingerprinting and/or pixel differences
* [**Repost detection**](/docs/examples/repost) with support for external services (youtube, etc...)
* Global/subreddit-level **API caching**
* Support for [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) as criteria or Actions (writing notes)
* Docker container support
* Event notification via Discord
* **Web interface** for monitoring, administration, and oauth bot authentication

# Table of Contents

* [How It Works](#how-it-works)
* [Getting Started](#getting-started)
* [Configuration And Documentation](#configuration-and-documentation)
* [Web UI and Screenshots](#web-ui-and-screenshots)

### How It Works

Each subreddit using the RCB bot configures its behavior via their own wiki page. 

When a monitored **Event** (new comment/submission, new modqueue item, etc.) is detected the bot runs through a list of **Checks** to determine what to do with the **Activity** from that Event. Each **Check** consists of :

#### Kind

Is this check for a submission or comment?

#### Rules

A list of **Rule** objects to run against the **Activity**. Triggered Rules can cause the whole Check to trigger and run its **Actions**

#### Actions

A list of **Action** objects that describe what the bot should do with the **Activity** or **Author** of the activity (comment, remove, approve, etc.). The bot will run **all** Actions in this list.

___

The **Checks** for a subreddit are split up into **Submission Checks** and **Comment Checks** based on their **kind**. Each list of checks is run independently based on when events happen (submission or comment).

When an Event occurs all Checks of that type are run in the order they were listed in the configuration. When one check is triggered (an Action is performed) the remaining checks will not be run.

___

[Learn more about the RCB lifecycle and core concepts in the docs.](/docs#how-it-works)

## Getting Started

#### Operators

This guide is for users who want to **run their own bot on a ContextMod instance.**

See the [Operator's Getting Started Guide](/docs/gettingStartedOperator.md)

#### Moderators

This guide is for **reddit moderators** who want to configure an existing CM bot to run on their subreddit.

See the [Moderator's Getting Started Guide](/docs/gettingStartedMod.md)

## Configuration and Documentation

Context Bot's configuration can be written in YAML (like automoderator) or [JSON5](https://json5.org/). Its schema conforms to [JSON Schema Draft 7](https://json-schema.org/). Additionally, many **operator** settings can be passed via command line or environmental variables.

* For **operators** (running the bot instance) see the [Operator Configuration](/docs/operatorConfiguration.md) guide
* For **moderators** consult the [app schema and examples folder](/docs/#configuration-and-usage)

[**Check the full docs for in-depth explanations of all concepts and examples**](/docs)

## Web UI and Screenshots

### Dashboard

CM comes equipped with a dashboard designed for use by both moderators and bot operators.

* Authentication via Reddit OAuth -- only accessible if you are the bot operator or a moderator of a subreddit the bot moderates
* Connect to multiple ContextMod instances (specified in configuration)
* Monitor API usage/rates
* Monitoring and administration **per subreddit:**
  * Start/stop/pause various bot components
  * View statistics on bot usage (# of events, checks run, actions performed) and cache usage
  * View various parts of your subreddit's configuration and manually update configuration
  * View **real-time logs** of what the bot is doing on your subreddit
  * **Run bot on any permalink**

![Subreddit View](docs/images/subredditStatus.jpg)

### Bot Setup/Authentication

A bot oauth helper allows operators to define oauth credentials/permissions and then generate unique, one-time invite links that allow moderators to authenticate their own bots without operator assistance. [Learn more about using the oauth helper.](docs/botAuthentication.md#cm-oauth-helper-recommended)

Operator view/invite link generation:

![Oauth View](docs/images/oauth.jpg)

Moderator view/invite and authorization:

![Invite View](docs/images/oauth-invite.jpg)

### Configuration Editor

A built-in editor using [monaco-editor](https://microsoft.github.io/monaco-editor/) makes editing configurations easy:

* Automatic JSON or YAML syntax validation and formatting
* Automatic Schema (subreddit or operator) validation
* All properties are annotated via hover popups
* Unauthenticated view via `yourdomain.com/config`
* Authenticated view loads subreddit configurations by simple link found on the subreddit dashboard
* Switch schemas to edit either subreddit or operator configurations

![Configuration View](docs/images/editor.jpg)

## License

[MIT](/LICENSE)
