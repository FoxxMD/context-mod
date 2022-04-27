This getting started guide is for **Operators** -- that is, someone who wants to run the actual software for a ContentMod bot. If you are a **Moderator** check out the [moderator getting started](/docs/subreddit/gettingStarted.md) guide instead.

# Table of Contents

* [Installation](#installation)
* [Create a Reddit Client](#create-a-reddit-client)
* [Create a Minimum Configuration](#create-a-minimum-configuration)
  * [Local Installation](#local-installation)
  * [Docker Installation](#docker-installation)
* [Add a Bot to CM](#add-a-bot-to-cm)
* [Access The Dashboard](#access-the-dashboard)
* [What's Next?](#whats-next)

# Installation

Follow the [installation](/docs/operator/installation.md) documentation. It is recommended to use **Docker** since it is self-contained.

# Create a Reddit Client

[Create a reddit client](/docs/operator/README.md#provisioning-a-reddit-client)

# Create a Minimum Configuration

Using the information you received in the previous step [create a minimum file configuration](/docs/operator/configuration.md#minimum-configuration) save it as `config.yaml` somewhere.

# Start ContextMod With Configuration

## Local Installation

If you [installed CM locally](/docs/installation.md#locally) move your configuration file `config.yaml` to the root of the project directory (where `package.json`) is located.

From the root directory run this command to start CM

```
node src/index.js run
```

## Docker Installation

If you [installed CM using Docker](/docs/installation.md#docker-recommended) make note of the directory you saved your minimum configuration to and substitute its full path for `host/path/folder` in the docker command show in the [docker install directions](/docs/operator/installation.md#docker-recommended)

# Add A Bot to CM

Once CM is up and running use the [CM OAuth Helper](/docs/operator/addingBot.md#cm-oauth-helper-recommended) to add authorize and add a Bot to your CM instance.

# Access The Dashboard

Congratulations! You should now have a fully authenticated bot running on a ContextMod instance.

In order for your Bot to operate in a subreddit it **must be a moderator in that subreddit.** This may be your own subreddit or someone else's.

To monitor the behavior of bots running on your instance visit http://localhost:8085.

# What's Next?

As an operator you should familiarize yourself with how the [operator configuration](/docs/operator/configuration.md) you made works. This will help you understand how to get the most of your CM instance by leveraging the [Cache](/docs/oeprator/caching.md) and [Database](/docs/operator/database.md) effectively as well as provide you will all possible options for configuring CM using the [schema.](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FOperatorConfig.json)

If you are also the moderator of the subreddit the bot will be running you should check out the [moderator getting started guide.](/docs/subreddit/gettingStarted.md#setup-wiki-page)

You might also be interested in these [quick tips for using the web interface](/docs/webInterface.md)
