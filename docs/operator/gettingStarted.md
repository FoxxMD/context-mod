---
parent: Operator
nav_order: 1
---

# Getting Started

This getting started guide is for **Operators** -- that is, someone who wants to run the actual software for a ContentMod bot. If you are a **Moderator** check out the [moderator getting started](/docs/moderators/gettingStarted.md) guide instead.

# Table of Contents

* [Installation](#installation)
* [Create a Reddit Client](#create-a-reddit-client)
* [Start ContextMod](#start-contextmod)
* [Add a Bot to CM](#add-a-bot-to-cm)
* [Access The Dashboard](#access-the-dashboard)
* [What's Next?](#whats-next)

# Installation

Follow the [installation](/docs/operator/installation.md) documentation. It is recommended to use **Docker** since it is self-contained.

# Create a Reddit Client

[Create a reddit client](/docs/operator/README.md#provisioning-a-reddit-client)

# Start ContextMod 

Start CM using the example command from your [installation](#installation) and visit http://localhost:8085

The First Time Setup page will ask you to input:

* Client ID (from [Create a Reddit Client](#create-a-reddit-client))
* Client Secret (from [Create a Reddit Client](#create-a-reddit-client))
* Operator -- this is the username of your main Reddit account.

**Write Config** and then restart CM. You have now created the [minimum configuration](/docs/operator/configuration.md#minimum-configuration) required to run CM.

# Add A Bot to CM

You should automatically be directed to the [Bot Invite Helper](/docs/operator/addingBot.md#cm-oauth-helper-recommended) used to authorize and add a Bot to your CM instance.

Follow the directions here and **create an Authorization Invite** at the bottom of the page. 

Next, login to Reddit with the account you will be using as the Bot and then visit the **Authorization Invite** link you created. Follow the steps there to finish adding the Bot to your CM instance.

# Access The Dashboard

Congratulations! You should now have a fully authenticated bot running on a ContextMod instance.

In order for your Bot to operate in a subreddit it **must be a moderator in that subreddit.** This may be your own subreddit or someone else's.

To monitor the behavior of bots running on your instance visit http://localhost:8085.

# What's Next?

As an operator you should familiarize yourself with how the [operator configuration](/docs/operator/configuration.md) you made works. This will help you understand how to get the most of your CM instance by leveraging the [Cache](/docs/oeprator/caching.md) and [Database](/docs/operator/database.md) effectively as well as provide you will all possible options for configuring CM using the [schema.](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

If you are also the moderator of the subreddit the bot will be running you should check out the [moderator getting started guide.](/docs/moderators/gettingStarted.md#setup-wiki-page)

You might also be interested in these [quick tips for using the web interface](/docs/webInterface.md). Additionally, on the dashboard click the **Help** button at the top of the page to get a guided tour of the dashboard.
