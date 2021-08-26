The **Regex** rule matches on text content from a comment or submission in the same way automod uses regex. The rule, however, provides additional functionality automod does not:

* Can set the **number** of matches that trigger the rule (`matchThreshold`)

Which can then be used in conjunction with a [`window`](https://github.com/FoxxMD/context-mod/blob/master/docs/activitiesWindow.md) to match against activities from the history of the Author of the Activity being checked (including the Activity being checked):

* Can set the **number of Activities** that meet the `matchThreshold` to trigger the rule (`activityMatchThreshold`)
* Can set the **number of total matches** across all Activities to trigger the rule (`totalMatchThreshold`)
* Can set the **type of Activities** to check (`lookAt`)
* When an Activity is a Submission can **specify which parts of the Submission to match against** IE title, body, and/or url (`testOn`)

### Examples

* [Trigger if regex matches against the current activity](/docs/examples/regex/matchAnyCurrentActivity.json5)
* [Trigger if regex matches 5 times against the current activity](/docs/examples/regex/matchThresholdCurrentActivity.json5)
* [Trigger if regex matches against any part of a Submission](/docs/examples/regex/matchSubmissionParts.json5)
* [Trigger if regex matches any of Author's last 10 activities](/docs/examples/regex/matchHistoryActivity.json5)
* [Trigger if regex matches at least 3 of Author's last 10 activities](/docs/examples/regex/matchActivityThresholdHistory.json5)
* [Trigger if there are 5 regex matches in the Author's last 10 activities](/docs/examples/regex/matchTotalHistoryActivity.json5)
* [Trigger if there are 5 regex matches in the Author's last 10 comments](/docs/examples/regex/matchSubsetHistoryActivity.json5)
