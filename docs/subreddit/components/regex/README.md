The **Regex** rule matches on text content from a comment or submission in the same way automod uses regex. The rule, however, provides additional functionality automod does not:

* Can set the **number** of matches that trigger the rule (`matchThreshold`)

Which can then be used in conjunction with a [`window`](https://github.com/FoxxMD/context-mod/blob/master/docs/activitiesWindow.md) to match against activities from the history of the Author of the Activity being checked (including the Activity being checked):

* Can set the **number of Activities** that meet the `matchThreshold` to trigger the rule (`activityMatchThreshold`)
* Can set the **number of total matches** across all Activities to trigger the rule (`totalMatchThreshold`)
* Can set the **type of Activities** to check (`lookAt`)
* When an Activity is a Submission can **specify which parts of the Submission to match against** IE title, body, and/or url (`testOn`)

### Examples

* Trigger if regex matches against the current activity - [YAML](/docs/subreddit/components/regex/matchAnyCurrentActivity.yaml) | [JSON](/docs/subreddit/components/regex/matchAnyCurrentActivity.json5)
* Trigger if regex matches 5 times against the current activity - [YAML](/docs/subreddit/components/regex/matchThresholdCurrentActivity.yaml) | [JSON](/docs/subreddit/components/regex/matchThresholdCurrentActivity.json5)
* Trigger if regex matches against any part of a Submission - [YAML](/docs/subreddit/components/regex/matchSubmissionParts.yaml) | [JSON](/docs/subreddit/components/regex/matchSubmissionParts.json5)
* Trigger if regex matches any of Author's last 10 activities - [YAML](/docs/subreddit/components/regex/matchHistoryActivity.yaml) | [JSON](/docs/subreddit/components/regex/matchHistoryActivity.json5)
* Trigger if regex matches at least 3 of Author's last 10 activities - [YAML](/docs/subreddit/components/regex/matchActivityThresholdHistory.json5) | [JSON](/docs/subreddit/components/regex/matchActivityThresholdHistory.json5)
* Trigger if there are 5 regex matches in the Author's last 10 activities - [YAML](/docs/subreddit/components/regex/matchTotalHistoryActivity.yaml) | [JSON](/docs/subreddit/components/regex/matchTotalHistoryActivity.json5) 
* Trigger if there are 5 regex matches in the Author's last 10 comments - [YAML](/docs/subreddit/components/regex/matchSubsetHistoryActivity.yaml) | [JSON](/docs/subreddit/components/regex/matchSubsetHistoryActivity.json5)
* Remove comments that are spamming discord links - [YAML](/docs/subreddit/components/regex/removeDiscordSpam.yaml) | [JSON](/docs/subreddit/components/regex/removeDiscordSpam.json5)
  * Differs from just using automod because this config can allow one-off/organic links from users who DO NOT spam discord links but will still remove the comment if the user is spamming them
