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
* Any text-based actions (comment, submission, message, etc...) can be configured via a wiki page or raw text in JSON
* All text-based actions support [mustache](https://mustache.github.io) templating
* History-based rules support multiple "valid window" types -- [ISO 8601 Durations](https://en.wikipedia.org/wiki/ISO_8601#Durations), [Day.js Durations](https://day.js.org/docs/en/durations/creating), and submission/comment count limits.
* All rules support skipping behavior based on author criteria -- name, css flair/text, and moderator status
* Docker container support *(coming soon...)*

### How It Works

Context Bot's configuration is made up of an array of **Checks**. Each **Check** consists of :

#### Kind

Is this check for a submission or comment?

#### Rules

A list of **Rule** objects to run against the activity. If **any** Rule object is triggered by the activity then the Check runs its **Actions**

#### Actions

A list of **Action** objects that describe what the bot should do with the activity or author of the activity. The bot will run **all** Actions in this list.

___

The **Checks** for a subreddit are split up into **Submission Checks** and **Comment Checks** based on their **kind**. Each list of checks is run independently based on when events happen (submission or comment).

When an event occurs all Checks of that type are run in the order they were listed in the configuration. When one check is triggered (an action is performed) the remaining checks will not be run.
