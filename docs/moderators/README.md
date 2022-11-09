---
has_children: true
title: Moderators
nav_order: 2
---

This section is for **reddit moderators**. It covers how to use a CM bot for your subreddit.

If you are trying to run a ContextMod instance (the actual software) please refer to the [operator section](/docs/operator/README.md).

# Table of Contents

* [Overview](#overview)
  * [Your Relationship to CM](#your-relationship-to-cm)
    * [Operator](#operator)
    * [Your Bot](#your-bot)
* [Getting Started](#getting-started)
* [Accessing The Bot](#accessing-the-bot)
  * [Editing The Bot](#editing-the-bot)
* [Configuration](#configuration)
* [Guest Access](#guest-access)

# Overview

The Context Mod **software** can manage multiple **bots** (reddit accounts used as bots, like `/u/MyCMBot`). Each bot can manage (run) multiple **subreddits** which is determined by the subreddits the account is a moderator of.

You, the moderator of a subreddit a CM bot runs in, can access/manage the Bot using the CM software's [web interface](/docs/images/subredditStatus.jpg) and control its behavior using the [web editor.](/docs/images/editor.jpg)

## Your Relationship to CM

It is important to understand the relationship between you (the moderator), the bot, and the operator (the person running the CM software).

The easiest way to think about this is in relation to how you use Automoderator and interact with Reddit as a moderator. As an analogy:

### Operator

The operator is the person running the actual server/machine the Context Mod software is on. 

They are best thought of as **Reddit:**

* Mostly hands-off when it comes to the bot and interacting with your subreddit
* You must interact with Reddit first before you can use automoderator (login, create a subreddit, etc...)

Unlike reddit, though, there is a greater level of trust required between you and the Operator because what you make the Bot do ultimately affects the Operator since they are the ones actually running your Bot and making API calls to reddit.

### Your Bot

Your bot is like an **invite-only version of Automoderator**:

* Unlike automoderator, you **must** interact with the Operator in order to get the bot working. It is not public for anyone to use.
* Like automoderator, you **must** create a [configuration](/docs/moderators/components/README.md) for it do anything.
  * The bot does not come pre-configured for you. It is a blank slate and requires user input to be useful.
* Also like automoderator, you are **entirely in control of the bot.**
  * You can start, stop, and edit its behavior at any time without needing to communicate with the Operator.
  * CM provides you _tools_, different ways the Bot can detect patterns in your subreddit/users as well as actions it can, and you can decide to use them however you want.
* Your bot is **only accessible to moderators of your subreddit.**

# Getting Started

The [Getting Started](/docs/moderators/gettingStarted.md) guide lays out the steps needed to go from nothing to a working Bot. If you are a moderator new to Context Mod this is where you want to begin.

# Accessing The Bot

All bot management and editing is done through the [web interface.](/docs/images/subredditStatus.jpg) The URL used for accessing this interface is given to you by the **Operator** once they have agreed to host your bot/subreddit.

NOTE: This interface is **only access to moderators of your subreddit** and [guests.](#guest-access) You must login to the web interface **with your moderator account** in order to access it.

A **guided tour** that helps show how to manage the bot at a high-level is available on the web interface by clicking the **Help** button in the top-right of the page.

## Editing The Bot

Find the [editor in the web interface](/docs/webInterface.md#editingupdating-your-config) to access the built-in editor for the bot.

[The editor](/docs/images/editor.jpg) should be your all-in-one location for viewing and editing your bot's behavior. **It is equivalent to Automoderator's editor page.**

The editor features:

* syntax validation and highlighting
* configuration auto-complete and documentation (hover over properties)
* built-in validation using Microsoft Word "squiggly lines" indicators and an error list at the bottom of the window
* built-in saving (at the top of the window)

# Configuration

Use the [Configuration Reference](/docs/moderators/components/README.md) to learn about all the different components available for building a CM configuration.

Additionally, refer to [How It Works](/docs/README.md#how-it-works) and [Core Concepts](/docs/README.md#concepts) to learn the basic of CM configuration.

After you have the basics under your belt you could use the [subreddit configurations cookbook](/docs/moderators/components/cookbook) to familiarize yourself with a complete configuration and ways to use CM.

# Guest Access

CM supports **Guest Access**. Reddit users who are given Guest Access to your bot are allowed to access the web interface even though they are not moderators.

Additionally, they can edit the subreddit's config using the bot. If a Guest edits your config their username will be mentioned in the wiki page edit reason.

Guests can do everything a regular mod can except view/add/remove Guest. They can be removed at any time or set with an expiration date that their access is removed on.

**Guests are helpful if you are new to CM and know reddit users that can help you get started.**

[Add guests from the Subreddit tab in the main interface.](/docs/images/guests.jpg)
