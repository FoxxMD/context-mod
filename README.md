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
* One instance can manage all moderated subreddits for the authenticated account
* **Per-subreddit configuration** is handled by JSON stored in the subreddit wiki
* Any text-based actions (comment, submission, message, usernotes, ban, etc...) can be configured via a wiki page or raw text in JSON and support [mustache](https://mustache.github.io) [templating](/docs/actionTemplating.md)
* History-based rules support multiple "valid window" types -- [ISO 8601 Durations](https://en.wikipedia.org/wiki/ISO_8601#Durations), [Day.js Durations](https://day.js.org/docs/en/durations/creating), and submission/comment count limits.
* Support Activity skipping based on:
  * Author criteria (name, css flair/text, age, karma, moderator status, and [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes))
  * Activity state (removed, locked, distinguished, etc.)
* Rules and Actions support named references (write once, reference anywhere)
* Global/subreddit-level **API caching**
* Support for [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) as criteria or Actions (writing notes)
* Docker container support
* Event notification via Discord
* **Web interface** for monitoring and administration

# Table of Contents

* [How It Works](#how-it-works)
* [Installation](#installation)
* [Configuration And Docs](#configuration)
* [Usage](#usage)
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

## Installation

To provide data/environmental variables to your application refer to the [operator configuration guide.](docs/operatorConfiguration.md)

### Locally

Requirements:

* Typescript >=4.3.5
* Node >=15

Clone this repository somewhere and then install from the working directory

```bash
git clone https://github.com/FoxxMD/reddit-context-bot.git .
cd reddit-context-bot
npm install
tsc -p .
```

### [Docker](https://hub.docker.com/r/foxxmd/reddit-context-bot)

```
foxxmd/reddit-context-bot:latest
```

Adding **environmental variables** to your `docker run` command will pass them through to the app EX:
```
docker run -e "CLIENT_ID=myId" ... foxxmd/reddit-context-bot
```

### [Heroku Quick Deploy](https://heroku.com/about)
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://dashboard.heroku.com/new?template=https://github.com/FoxxMD/reddit-context-bot)


## Configuration

[**Check the docs for in-depth explanations of all concepts and examples**](/docs)

Context Bot's configuration can be written in JSON, [JSON5](https://json5.org/) or YAML. It's [schema](/src/Schema/App.json) conforms to [JSON Schema Draft 7](https://json-schema.org/).

I suggest using [Atlassian JSON Schema Viewer](https://json-schema.app/start) ([direct link](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)) so you can view all documentation while also interactively writing and validating your config! From there you can drill down into any object, see its requirements, view an example JSON document, and live-edit your configuration on the right-hand side.

## Usage

* For operating your own application/bot see [Operator Configuration](docs/operatorConfiguration.md)
  * CLI usage specifically is at  [Operator Configuration#Cli Usage](docs/operatorConfiguration.md#cli-usage)
* For subreddit moderators visit your operator's web interface or refer to the web interface documentation (TODO)

## Web UI and Screenshots

RCB comes equipped with a web interface designed for use by both moderators and bot operators. Some feature highlights:

* Authentication via Reddit OAuth -- only accessible if you are the bot operator or a moderator of a subreddit the bot moderates
* Monitor API usage/rates
* Monitoring and administration **per subreddit:**
  * Start/stop/pause various bot components
  * View statistics on bot usage (# of events, checks run, actions performed) and cache usage
  * View various parts of your subreddit's configuration and manually update configuration
  * View **real-time logs** of what the bot is doing on your subreddit
  * **Run bot on any permalink**

![Subreddit View](docs/screenshots/subredditStatus.jpg)

Additionally, a helper webpage is available to help initial setup of your bot with reddit's oauth authentication. [Learn more about using the oauth helper.](docs/botAuthentication.md#rcb-oauth-helper-recommended)

![Oauth View](docs/screenshots/oauth.jpg)

## License

[MIT](/LICENSE)
