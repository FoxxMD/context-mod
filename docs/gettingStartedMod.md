This getting started guide is for **reddit moderators** -- that is, someone who wants **an existing ContextMod bot to run on their subreddit.** If you are trying to run a ContextMod
 instance (software) please refer to the [operator getting started](/docs/gettingStartedOperator.md) guide.

# Table of Contents

* [Prior Knowledge](#prior-knowledge)
* [Mod the Bot](#mod-the-bot)
* [Creating Configuration](#configuring-the-bot)
* [Monitor the Bot](#monitor-the-bot)

# Prior Knowledge

Before continuing with this guide you should first make sure you understand how a ContextMod works. Please review this documentation:

* [How It Works](/docs#how-it-works)
* [Core Concepts](/docs#concepts)

# Mod The Bot

First ensure that you are in communication with the **operator** for this bot. The bot **will not automatically accept a moderator invitation,** it must be manually done by the bot operator. This is an intentional barrier to ensure moderators and the operator are familiar with their respective needs and have some form of trust.

Now invite the bot to moderate your subreddit. The bot should have at least these permissions:

* Manage Users
* Manage Posts and Comments
* Manage Flair

Additionally, the bot must have the **Manage Wiki Pages** permission if you plan to use [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes). If you are not planning on using this feature and do not want the bot to have this permission then you **must** ensure the bot has visibility to the configuration wiki page (detailed below).

# Configuring the Bot

## Setup wiki page

* Visit the wiki page of the subreddit you want the bot to moderate
  * The default location the bot checks for a configuration is at `https://old.reddit.com/r/YOURSUBERDDIT/wiki/botconfig/contextbot`
  * If the page does not exist create it
* Ensure the wiki page visibility is restricted
  * On the wiki page click **settings** (**Page settings** in new reddit)
  * Check the box for **Only mods may edit and view** and then **save**
    * Alternatively, if you did not give the bot the **Manage Wiki Pages** permission then add it to the **allow users to edit page** setting

## Procure a configuration

Now you need to make the actual configuration that will be used to configure the bot's behavior on your subreddit. This may have already been done for you by your operator or you may be copying a fellow moderator's configuration.

If you already have a configuration you may skip the below step and go directly to [saving your configuration](#saving-your-configuration)

### Using an Example Config

Visit the [Examples](https://github.com/FoxxMD/context-mod/tree/master/docs/examples) folder to find various examples of individual rules as well as full, subreddit-ready configurations (coming soon...)

After you have found a configuration to use as a starting point:

* In a new tab open the github page for the configuration you want ([example](/docs/examples/repeatActivity/crosspostSpamming.json5))
* Click the **Raw** button, then select all and copy all of the text to your clipboard.

## Saving Your Configuration

* Open the wiki page you created in the [previous step](#setup-wiki-page) and click **edit**
  * Copy-paste your configuration into the wiki text box
  * Save the edited wiki page

___

The bot automatically checks for new configurations on your wiki page every 5 minutes. If your operator has the web interface accessible you may login there and force the config to update on your subreddit.

# Monitor the Bot

Monitoring the behavior of the bot is dependent on how your operator setup their instance. ContextMod comes with a built-in web interface that is secure and accessible only to moderates of subreddits it is running on. However there is some additional setup for the operator to perform in order to make this interface accessible publicly. If you do not have access to this interface please communicate with your operator.

After logging in to the interface you will find your subreddit in a tab at the top of the web page. Selecting your subreddit will give you access to:

* Current status of the bot
* Current status of your configuration
* Statistics pertaining to the number of checks/rules/actions run and cache usage
* **A real-time view for bot logs pertaining to your subreddit**

The logs are the meat and potatoes of the bot and the main source of feedback you have for fine-tuning the bot's behavior. The **verbose** log level will show you:

* The event being processed
* The individual results of triggered rules, per check
* The checks that were run and their rules
* The actions performed, with markdown content preview, of triggered checks

This information should enable you to tweak the criteria for your rules in order to get the required behavior from the bot.

Additionally, you can test your bot on any comment/submission by entering its permalink in the text bot at the top of the logs and selecting **Dry Run** -- this will run the bot on an Activity without actually performing any actions allowing you to preview the results of a run.
