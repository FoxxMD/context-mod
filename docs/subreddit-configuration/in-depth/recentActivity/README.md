---
grand_parent: Subreddit Configuration
parent: In Depth
---

# Recent Activity Rule

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

* Free Karma Subreddits [YAML](/docs/moderators/components/recentActivity/freeKarma.yaml) | [JSON](/docs/moderators/components/recentActivity/freeKarma.json5) - Check if the Author has recently posted in any "free karma" subreddits
* Submission in Free Karma Subreddits [YAML](/docs/moderators/components/recentActivity/freeKarmaOnSubmission.yaml) | [JSON](/docs/moderators/components/recentActivity/freeKarmaOnSubmission.json5) - Check if the Author has posted the Submission this check is running on in any "free karma" subreddits recently

# [Template Variables](/docs/moderators/actionTemplating.md)

|         Name         |                        Description                         |                                                                   Example                                                                    |
|----------------------|------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| `result`             | Summary of rule results (also found in Actioned Events)    | 9 activities found in 2 of the specified subreddits (out of 21 total) MET threshold of >= 1 activities -- subreddits: SubredditA, SubredditB |
| `window`             | Number or duration of Activities considered from window    | 100 activities                                                                                                                               |
| `subSummary`         | Comma-delimited list of subreddits matched by the criteria | SubredditA, SubredditB                                                                                                                       |
| `subCount`           | Number of subreddits that match the criteria               | 2                                                                                                                                            |
| `totalCount`         | Total number of activities found by criteria               | 9                                                                                                                                            |
| `threshold`          | The threshold used to trigger the rule                     | `>= 1`                                                                                                                                       |
| `karmaThreshold`     | If present, the karma threshold used to trigger the rule   | `> 5`                                                                                                                                        |
| `combinedKarma`      | Total number of karma gained from the matched activities   | 10                                                                                                                                           |
| `subredditBreakdown` | A markdown list of filtered activities by subreddit        | * SubredditA - 5 (71%) \n * Subreddit B - 2 (28%)                                                                                            |
