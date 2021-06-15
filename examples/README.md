# Examples

This directory contains example of valid, ready-to-go configurations for Context Bot for the purpose of:

* showcasing what the bot can do
* providing best practices for writing your configuration
* providing generally useful configurations **that can be used immediately** or as a jumping-off point for your configuration

### Creating Your Configuration

#### Get the raw contents of the configuration

* In a new tab open the github page for the configuration you want ([example](/examples/repeatActivity/crosspostSpamming.json5))
* Click the **Raw** button...keep this tab open and move on to the next step

#### Edit your wiki configuration

* Visit the wiki page of the subreddit you want the bot to moderate
    * Using default bot settings this will be `https://old.reddit.com/r/YOURSUBERDDIT/wiki/botconfig/contextbot`
    * If the page does not exist create it, otherwise click **Edit**
* Copy-paste the configuration into the wiki text box
    * In the previous tab you opened (for the configuration) **Select All** (Ctrl+A), then **Copy**
    * On the wiki page **Paste** into the text box
* Save the edited wiki page
* Ensure the wiki page visibility is restricted
    * On the wiki page click **settings** (**Page settings** in new reddit)
    * Check the box for **Only mods may edit and view** and then **save**
    
### Examples Overview

* Rules
  * [Attribution](/examples/attribution)
  * [Recent Activity](/examples/recentActivity)
  * [Repeat Activity](/examples/repeatActivity)
  * [History](/examples/history)
  * [Author](/examples/author)
* [Toolbox User Notes](/examples/userNotes)
* [Advanced Concepts](/examples/advancedConcepts)
  * [Rule Sets](/examples/advancedConcepts/ruleSets.json5)
  * [Name Rules](/examples/advancedConcepts/ruleNameReuse.json5)
  * [Check Ordering](/examples/advancedConcepts)
* Subreddit-ready examples
  * Coming soon...
