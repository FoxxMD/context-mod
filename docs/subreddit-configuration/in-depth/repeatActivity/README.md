---
grand_parent: Subreddit Configuration
parent: In Depth
---

# Repeat Activity Rule

The **Repeat Activity** rule will check for patterns of repetition in an Author's Submission/Comment history. Consult the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FRepeatActivityJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

To determine sameness it uses an average of [Dice's Coefficient](https://en.wikipedia.org/wiki/S%C3%B8rensen%E2%80%93Dice_coefficient), [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity), and [Levenshtein Distance](https://en.wikipedia.org/wiki/Levenshtein_distance) weighted by the length of the content being compared (more weight for longer content).

## Tuning

The most critical properties for this Rule are **gapAllowance** and **lookAt**.

### `lookAt`

Determines which Activities from a User's history are checked when looking for repeats.

Can be either:

* `all` -- All of a user's submissions and comments are considered
* `submissions` -- Only a user's submissions are considered

Defaults to `all`

### `gapAllowance`

`gapAllowance` determines how many **non-repeat Activities** are "allowed" between "in a row" submissions. `N` number of non-repeat activities will be thrown away during the count which allows checking for patterns with a bit of "fuzziness".

By default `gapAllowance: 0` so all repeats must be truly consecutive.
___
Consider the following example in a user's history:

* crossposts 2 times
* 1 comment
* crossposts 2 times
* 2 comments
* crossposts 4 times

Your goal is to remove a submission if it has been crossposted **5 times.**

With defaults for lookAt and gapAllowance this rule **would not be triggered** because no set of consecutive submissions was repeated 5 times.

With only `lookAt: "submissions"` this rule **would trigger** because all the comments would be ignored resulting in 8 repeats.

With only `gapAllowance: 1` this rule **would not trigger** because the 2 comment non-repeat would break the "in a row" count.

With only `gapAllowance: 2` this rule **would trigger** because the the 1 and 2 comment non-repeats would be thrown out resulting in 8 repeats.

**Note:** `lookAt: "submissions"` should be used with caution because all comments are thrown away. This isn't indicative of real repeat behavior if the user is a heavy commenter. For this reason the default is `all`.

## Examples

* Crosspost Spamming [JSON](/docs/moderators/components/repeatActivity/crosspostSpamming.json5) | [YAML](/docs/moderators/components/repeatActivity/crosspostSpamming.yaml) - Check if an Author is spamming their Submissions across multiple subreddits
* Burst-posting [JSON](/docs/moderators/components/repeatActivity/burstPosting.json5) | [YAML](/docs/moderators/components/repeatActivity/burstPosting.yaml) - Check if Author is crossposting their Submissions in short bursts

# [Template Variables](/docs/moderators/actionTemplating.md)

|         Name          |                       Description                       |                           Example                           |
|-----------------------|---------------------------------------------------------|-------------------------------------------------------------|
| `result`              | Summary of rule results (also found in Actioned Events) | 1 of 1 unique items repeated >= 7 times, largest repeat: 22 |
| `window`              | Number or duration of Activities considered from window | 100 activities                                              |
| `threshold`           | Number of repeats that trigger rule                     | `>= 7`                                                      |
| `totalTriggeringSets` | Number of sets of repeats that matched threshold        | 1                                                           |
| `largestRepeat`       | The largest number of repeats in a single set           | 22                                                          |
| `gapAllowance`        | Number of non-repeat activities allowed between repeats | 2                                                           |
