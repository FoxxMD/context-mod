---
nav_order: 5
---

# Web Interface

## Editing/Updating Your Config

* Open the editor for your subreddit
    * In the web dashboard \-> r/YourSubreddit \-> Config -> **View** [(here)](images/config/config.jpg)
* Follow the directions on the [link at the top of the window](images/config/save.png) to enable config editing using your moderator account
    * After enabling editing just click "save" at any time to save your config
    * After you have added/edited your config the bot will detect changes within 5 minutes or you can manually trigger it by clicking **Update**

## General Config (Editor) Tips

* The editor will automatically validate your [syntax (formatting)](images/config/syntax.png) and [config correctness](images/config/correctness.png) (property names, required properties, etc.)
    * These show up as squiggly lines like in Microsoft Word and as a [list at the bottom of the editor](images/config/errors.png)
* In your config all **Checks** and **Actions** have two properties that control how they behave:
    * [**Enable**](images/config/enable.png) (defaults to `enable: true`) -- Determines if the check or action is run, at all
    * **Dryrun** (defaults to `dryRun: false`) -- When `true` the check or action will run but any **Actions** that may be triggered will "pretend" to execute but not actually talk to the Reddit API.
      * Use `dryRun` to test your config without the bot making any changes on reddit
    * When starting out with a new config it is recommended running the bot with remove/ban actions **disabled**
        * Use `report` actions to get reports in your modqueue from the bot that describe what it detected and what it would do about it
        * Once the bot is behaving as desired (no false positives or weird behavior) destructive actions can be enabled or turned off of dryrun

## Web Dashboard Tips

* Click the **Help** button at the top of the page to get a **guided tour of the dashboard**
* Use the [**Overview** section](images/botOperations.png) to control the bot at a high-level
* You can **manually run** the bot on any activity (comment/submission) by pasting its permalink into the [input field below the Overview section](images/runInput.png) and hitting one of the **run buttons**
    * **Dry run** will make the bot run on the activity but it will only **pretend** to run actions, if triggered. This is super useful for testing your config without consequences
    * **Run** will do everything
* All of the bot's activity is shown in real-time in the [log section](images/logs.png)
    * This will output the results of all run checks/rules and any actions that run
* You can view summaries of all activities that triggered a check (had actions run) by clicking on [Actioned Events](images/actionsEvents.png)
    * This includes activities run with dry run
