# Operator Guide

An **Operator** is the user **running the ContextMod software.**

They are responsible for configuring the software at a high-level and managing associated infrastructure such as:

* Creating cache/database servers and configuring their connections in CM
* Provisioning the [Reddit Clients](#provisioning-a-reddit-client) needed to run bots and the CM UI
* Providing [global-level configuration](/docs/operator/configuration.md) that affects general bot/subreddit behavior
* Onboarding new bots/subreddits

# Table of Contents

* [Overview](#overview)
  * [Client-Server Architecture](/docs/serverClientArchitecture.md)
* [Getting Started](/docs/operator/gettingStarted.md)
* [Installation](/docs/operator/installation.md)
* [Provisioning a Reddit Client](#provisioning-a-reddit-client)
* [Configuration](/docs/operator/configuration.md)
* [Adding A Bot](/docs/operator/addingBot.md)

# Overview

CM is composed of two applications that operate independently but are packaged together such that they act as one piece of software:

* **Server** -- Responsible for **running the bot(s)** and providing an API to retrieve information on and interact with them EX start/stop bot, reload config, retrieve operational status, etc.
* **Client** -- Responsible for serving the **web interface** and handling the bot oauth authentication flow between operators and subreddits/bots.

Both applications authenticate, and are primarily operated, by using [Reddit's API through OAuth.](https://github.com/reddit-archive/reddit/wiki/OAuth2) The **Client** uses OAuth to verify the identity of moderators logging into the web interface. The **Server** uses oauth tokens to interact with Reddit's API and operate all the configured bots.

In its default mode of operation CM takes care of all the interaction between **Server** and **Client** for you so that you can effectively treat it as a monolithic application. Learn more about CM's architecture and other operation modes in the [Server-Client Architecture documentation.](/docs/serverClientArchitecture.md)

# [Getting Started](/docs/operator/gettingStarted.md)

The [Getting Started](/docs/operator/gettingStarted.md) guide serves as a straight-forward "how-to" for standing up a CM server from scratch with minimal explanation.

# [Installation](/docs/operator/installation.md)

CM has many installation options:

* Locally, from source, as a typescript project
* Built/pulled from a Docker image hosted on Dockerhub
* Deployed to Heroku with a Quick Deploy template (experimental)

Refer to the [Installation](/docs/operator/installation.md) docs for more information.

# Provisioning A Reddit Client

As mentioning in the [Overview](#overview), CM operates primarily using Reddit's API through OAuth. You must create a [Reddit Client](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started) in order to interact with the API.

## Create Application

Visit [your reddit preferences](https://www.reddit.com/prefs/apps) and at the bottom of the page go through the **create an(other) app** process.

* Give it a **name**
* Choose **web app**
* If you know what you will use for **redirect uri** go ahead and use it, otherwise use `http://localhost:8085/callback`

Click **create app**.

Then write down your **Client ID, Client Secret, and Redirect Uri** somewhere

# [Configuration](/docs/operator/configuration.md)

The [Configuration](/docs/operator/configuration.md) documentation covers:

* How CM's configuration can be defined
* How to create and define location for a config file
* Running CM from the command line
* Documentation for configuration on Bots, the web client, API, and more...

# [Adding A Bot](/docs/operator/addingBot.md)

The [Adding A Bot](/docs/operator/addingBot.md) documentation covers:

* What is a Bot?
* What is needed to add a Bot to CM?
* Different approaches to authenticating and adding a Bot to CM
