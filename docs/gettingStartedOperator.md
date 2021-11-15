This getting started guide is for **Operators** -- that is, someone who wants to run the actual software for a ContentMod bot. If you are a **Moderator** check out the [moderator getting started](/docs/gettingStartedMod.md) guide instead.

# Table of Contents

* [Installation](#installation)
  * [Docker](#docker-recommended)
  * [Locally](#locally)
  * [Heroku](#heroku-quick-deployhttpsherokucomabout)
* [Bot Authentication](#bot-authentication)
* [Instance Configuration](#instance-configuration)
* [Run Your Bot and Start Moderating](#run-your-bot-and-start-moderating)

# Installation

In order to run a ContextMod instance you must first you must install it somewhere.

ContextMod can be run on almost any operating system but it is recommended to use Docker due to ease of deployment.

## Docker (Recommended)

PROTIP: Using a container management tool like [Portainer.io CE](https://www.portainer.io/products/community-edition) will help with setup/configuration tremendously.

### [Dockerhub](https://hub.docker.com/r/foxxmd/context-mod)

```
foxxmd/context-mod:latest
```

Adding **environmental variables** to your `docker run` command will pass them through to the app EX:
```
docker run -d -e "CLIENT_ID=myId" ... foxxmd/context-mod
```

### Locally

Requirements:

* Typescript >=4.3.5
* Node >=15

Clone this repository somewhere and then install from the working directory

```bash
git clone https://github.com/FoxxMD/context-mod.git .
cd context-mod
npm install
tsc -p .
```

### [Heroku Quick Deploy](https://heroku.com/about)
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://dashboard.heroku.com/new?template=https://github.com/FoxxMD/context-mod)

This template provides a **web** and **worker** dyno for heroku.

* **Web** -- Will run the bot **and** the web interface for ContextMod.
* **Worker** -- Will run **just** the bot.

Be aware that Heroku's [free dyno plan](https://devcenter.heroku.com/articles/free-dyno-hours#dyno-sleeping) enacts some limits:

* A **Web** dyno will go to sleep (pause) after 30 minutes without web activity -- so your bot will ALSO go to sleep at this time
* The **Worker** dyno **will not** go to sleep but you will NOT be able to access the web interface. You can, however, still see how Cm is running by reading the logs for the dyno.

If you want to use a free dyno it is recommended you perform first-time setup (bot authentication and configuration, testing, etc...) with the **Web** dyno, then SWITCH to a **Worker** dyno so it can run 24/7.

# Bot Authentication

Next you need to create a bot and authenticate it with Reddit. Follow the [bot authentication guide](/docs/botAuthentication.md) to complete this step.

# Instance Configuration

Finally, you must provide the credentials you received from the **Bot Authentication** step to the ContextMod instance you installed earlier. Refer to the [Operator Configuration](/docs/operatorConfiguration.md) guide to learn how this can be done as there are multiple approaches depending on how you installed the software.

Additionally, at this step you can also tweak many more settings and behavior concerning how your CM bot will operate.

# Run Your Bot and Start Moderating

Congratulations! You should now have a fully authenticated bot running on ContextMod software.

In order for your Bot to operate on reddit though it **must be a moderator in the subreddit you want it to run in.** This may be your own subreddit or someone else's.

**Note: ContextMod does not currently handle moderation invites automatically** and may never have this functionality. Due to the fact that many of its behaviors are api-heavy and that subreddits can control their own configuration the api and resource (cpu/memory) usage of a ContextMod instance can be highly variable. It therefore does not make sense to allow any/all subreddits to automatically have access to an instance through automatically accepting moderator invites. So...if you are planning to run a ContextMod instance for subreddits other than those you moderate you should establish solid trust with moderators of that subreddit as well as a solid line of communication in order to ensure their configurations can be tailored to best fit their needs and your resources.

Once you have logged in as your bot and manually accepted the moderator invite you will need to restart your ContextMod instance in order for these changes to take effect.
