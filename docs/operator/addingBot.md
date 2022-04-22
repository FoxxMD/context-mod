# Table of Contents

* [What is a Bot?](#what-is-a-bot)
* [Prerequisites](#Prerequisites)
* [Adding a Bot to CM](#adding-a-bot-to-cm)
  * [Using CM OAuth Helper (Recommended)](#cm-oauth-helper-recommended)
  * [Using Aardvark OAuth Helper](#aardvark-oauth-helper)

# What is a Bot?

A **reddit bot** is composed of two components:

* A normal **reddit account** like `u/MyRedditAccount`
* Software that performs actions **on behalf of that reddit account** using Reddit's API

There is nothing special about the account! What's special is how its used -- through the API *with bot software* like ContextMod.

# Prerequisites

These things need to be done before a Bot can be added to CM:

* [Provisioned a Reddit Client](/docs/operator/README.md#provisioning-a-reddit-client)
* You or the person who controls the Bot account must have account credentials (username/password). Logging in to reddit is part of the setup process.
  * If the bot does not exist **create a reddit account for it.**
  * If the bot does exist make sure you are in communication with the owner of the account.

# Adding A Bot to CM

## CM OAuth Helper (Recommended)

This method will use CM's built in oauth flow. It is recommended because:

* It's easy!
* Will ensure your bot is authenticated with the correct oauth permissions

### Start CM with the Minimum Configuration (Initial Setup)

If this is your **first time adding a bot** you must make sure you have

* done the [prerequisites](#prerequisites)
* created a [minimum operator configuration](/docs/operator/configuration.md#minimum-config)
  * that specifies the client id/secret from provisioning your reddit client
  * specified **Operator Name** in the configuration

It is important you define **Operator Name** because the auth route is **protected.** You must login to CM's web interface in order to access the route.

### Create A Bot Invite

Open the CM web interface (default is [http://localhost:8085](http://localhost:8085)) and login with the reddit account specified in **Operator Name.**

If this is your first time setting up a bot you should be automatically redirected to the auth page. Otherwise, visit [http://localhost:8085/auth/helper](http://localhost:8085/auth/helper)

Follow the directions in the helper to create a **Bot Invite Link.**

### Onboard the Bot

Visit the **Bot Invite Link** while **logged in to reddit as the bot account** to begin the onboarding process. Refer to the [Onboarding Your Bot]() subreddit documentation for more information on this process.

At the end of the onboarding process the bot should be automatically added to your operator configuration. If there is an issue with automatically adding it then the oauth credentials will be displayed at the end of onboarding and can be [manually added to the configuration.](/docs/operator/configuration.md#manually-adding-a-bot)

## Aardvark OAuth Helper

This method should only be used if you cannot use the [CM OAuth Helper method.](#cm-oauth-helper-recommended)

* Visit [https://not-an-aardvark.github.io/reddit-oauth-helper/](https://not-an-aardvark.github.io/reddit-oauth-helper/) and follow the instructions given.
  * **Note:** You will need to update the **redirect uri** you set when [provisioning your reddit client.](/docs/operator/README.md#provisioning-a-reddit-client)
* Input your **Client ID** and **Client Secret** in the text boxes with those names.
* Choose scopes. **It is very important you check everything on this list or CM may not work correctly**
  * edit
  * flair
  * history
  * identity
  * modcontributors
  * modflair
  * modposts
  * modself
  * modnote
  * mysubreddits
  * read
  * report
  * submit
  * wikiread
  * wikiedit (if you are using Toolbox User Notes)
* Click **Generate tokens**, you will get a popup asking you to approve access (or login) -- **the account you approve access with is the account that Bot will control.**
* After approving an **Access Token** and **Refresh Token** will be shown at the bottom of the page. Use these to [manually add a bot to your operator configuration.](/docs/operator/configuration.md#manually-adding-a-bot)
  * After adding the bot you will need to restart CM.
