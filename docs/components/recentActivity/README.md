# Recent Activity

Given a list subreddit criteria, the **Recent Activity** rule finds Activities matching those criteria in the Author's history over [window](#activities-window) and then allows for comparing different facets of the results.

Subreddit criteria can be:

* names
* regular expression for names
* [Subreddit meta properties](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FRecentActivityRuleJSONConfig/%23%2Fdefinitions%2FActivityThreshold/%23%2Fdefinitions%2FSubredditState?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json) like NSFW, description, is user profile, is author's profile, etc...

Facets available to compare from analyzed history:

* number of activities found EX `> 3` => more than 3 activities found
* aggregated karma from activities EX `> 50` => more than 50 combined karma from found activities
* number of subreddits found EX `> 5` => more than 5 distinct subreddits matching subreddit criteria found

The above can also be expressed as a percentage instead of number IE "more than 10% of activities in author history come from subreddits matching criteria"

The search can also be modified in a number of ways:

* Filter found activities using an [Item Filter](#item)
* Only return activities that match the Activity from the Event being processed
    * Using image detection (pixel or perceptual hash matching)
* Only return certain types of activities (only submission or only comments)

Consult the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FRecentActivityRuleJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

### Examples

* Free Karma Subreddits [YAML](/docs/components/recentActivity/freeKarma.yaml) | [JSON](/docs/components/recentActivity/freeKarma.json5) - Check if the Author has recently posted in any "free karma" subreddits
* Submission in Free Karma Subreddits [YAML](/docs/components/recentActivity/freeKarmaOnSubmission.yaml) | [JSON](/docs/components/recentActivity/freeKarmaOnSubmission.json5) - Check if the Author has posted the Submission this check is running on in any "free karma" subreddits recently
