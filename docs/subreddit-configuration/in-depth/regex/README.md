---
grand_parent: Subreddit Configuration
parent: In Depth
---

# Regex Rule

The **Regex** rule matches on text content from a comment or submission in the same way automod uses regex. The rule, however, provides additional functionality automod does not:

* Can set the **number** of matches that trigger the rule (`matchThreshold`)

Which can then be used in conjunction with a [`window`](../../activitiesWindow.md) to match against activities from the history of the Author of the Activity being checked (including the Activity being checked):

* Can set the **number of Activities** that meet the `matchThreshold` to trigger the rule (`activityMatchThreshold`)
* Can set the **number of total matches** across all Activities to trigger the rule (`totalMatchThreshold`)
* Can set the **type of Activities** to check (`lookAt`)
* When an Activity is a Submission can **specify which parts of the Submission to match against** IE title, body, and/or url (`testOn`)

### Examples

* Trigger if regex matches against the current activity - [YAML](matchAnyCurrentActivity.yaml) | [JSON](matchAnyCurrentActivity.json5)
* Trigger if regex matches 5 times against the current activity - [YAML](matchThresholdCurrentActivity.yaml) | [JSON](matchThresholdCurrentActivity.json5)
* Trigger if regex matches against any part of a Submission - [YAML](matchSubmissionParts.yaml) | [JSON](matchSubmissionParts.json5)
* Trigger if regex matches any of Author's last 10 activities - [YAML](matchHistoryActivity.yaml) | [JSON](matchHistoryActivity.json5)
* Trigger if regex matches at least 3 of Author's last 10 activities - [YAML](matchActivityThresholdHistory.json5) | [JSON](matchActivityThresholdHistory.json5)
* Trigger if there are 5 regex matches in the Author's last 10 activities - [YAML](matchTotalHistoryActivity.yaml) | [JSON](matchTotalHistoryActivity.json5) 
* Trigger if there are 5 regex matches in the Author's last 10 comments - [YAML](matchSubsetHistoryActivity.yaml) | [JSON](matchSubsetHistoryActivity.json5)
* Remove comments that are spamming discord links - [YAML](removeDiscordSpam.yaml) | [JSON](removeDiscordSpam.json5)
  * Differs from just using automod because this config can allow one-off/organic links from users who DO NOT spam discord links but will still remove the comment if the user is spamming them

# [Template Variables](../../actionTemplating.md)

|     Name      |                       Description                       |                                                               Example                                                                |
|---------------|---------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `result`      | Summary of rule results (also found in Actioned Events) | Criteria 1 ✓ -- Activity Match ✓ => 1 > 0 (Threshold > 0) and 1 Total Matches (Window: 1 Item) -- Matched Values: "example.com/test" |
| `matchSample` | A comma-delimited list of matches from activities       | "example.com/test"                                                                                                                   |
