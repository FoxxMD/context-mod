# Documentation

# Table of Contents

* [Getting Started](#getting-started)
* [How It Works](#how-it-works)
* [Concepts](#concepts)
  * [Check](#checks)
  * [Rule](#rule)
    * [Examples](#available-rules)
  * [Rule Set](#rule-set)
    * [Examples](#rule-set-examples)
  * [Action](#action)
    * [Examples](#available-actions)
  * [Filters](#filters)
* [Configuration and Usage](#configuration-and-usage)
* [Common Resources](#common-resources)
  * [Activities `window`](#activities-window)
  * [Comparisons](#thresholds-and-comparisons)
  * [Activity Templating](/docs/actionTemplating.md)
  * [Image Comparisons](#image-comparisons)
* [Best Practices](#best-practices)
  * [Named Rules](#named-rules)
  * [Rule Order](#rule-order)
  * [Caching](#caching)
* FAQ

## Getting Started

Review **at least** the **How It Works** and **Concepts** below, then:

* For **Operators** (running a bot instance) refer to [**Operator Getting Started**](/docs/gettingStartedOperator.md)  guide
* For **Moderators** (configuring an existing bot for your subreddit) refer to the [**Moderator Getting Started**](/docs/gettingStartedMod.md) guide

## How It Works

Where possible Context Mod (CM) uses the same terminology as, and emulates the behavior, of **automoderator** so if you are familiar with that much of this may seem familiar to you.

CM's lifecycle looks like this:

#### 1) A new event in your subreddit is received by CM

The events CM watches for are configured by you. These can be new modqueue/unmoderated items, submissions, or comments.

#### 2) CM sequentially processes each Check in your configuration

A **Check** is a set of:

* One or more **Rules** that define what conditions should **trigger** this Check
* One or more **Actions** that define what the bot should do once the Check is **triggered**

#### 3) Each Check is processed, *in order*, until a Check is triggered

Once a Check is **triggered** no more Checks will be processed. This means all subsequent Checks in your configuration (in the order you listed them) are basically skipped.

#### 4) All Actions from that Check are executed

After all Actions are executed CM returns to waiting for the next Event.

## Concepts

Core, high-level concepts regarding how CM works.

### Checks

A **Check** is the main logical unit of behavior for the bot. It is equivalent to "if X then Y". A Check is comprised of:

* One or more **Rules** that are tested against an **Activity**
* One of more **Actions** that are performed when the **Rules** are satisfied

The bot's configuration can be made up of one or more **Checks** that are processed **in the order they are listed in the configuration.**

Once a Check is **triggered** (its Rules are satisfied and Actions performed) all subsequent Checks are skipped.

Some other important concepts regarding Checks:

* All Checks have a **kind** (defined in the configuration) that determine if they should run on **Submissions** or **Comments**
* Checks have a **condition** property that determines when they are considered **triggered**
  * If the **condition** is `AND` then ALL of their **Rules** must be **triggered** for the Check to be **triggered**
  * If the **condition** is `OR` then if ANY **Rules** is triggered **triggered** then the Check is **triggered**

Examples of different types of Checks can be found in the [subreddit-ready examples.](/docs/examples/subredditReady)
  
### Rule

A **Rule** is some set of **criteria** (conditions) that are tested against an Activity (comment/submission), a User, or a User's history. A Rule is considered **triggered** when the **criteria** for that rule are found to be **true** for whatever is being tested against.

There are generally three main properties for a Rule:

* **Critiera** -- The conditions/values you want to test for.
* **Activities Window** -- If applicable, the range of activities that the **criteria** will be tested against.
* **Rule-specific options** -- Any number of options that modify how the **criteria** are tested.

CM has different **Rules** that can test against different types of behavior and aspects of a User, their history, and the Activity (submission/common) being checked.

#### Available Rules
Find detailed descriptions of all the Rules, with examples, below:

* [Attribution](/docs/examples/attribution)
* [Recent Activity](/docs/examples/recentActivity)
* [Repeat Activity](/docs/examples/repeatActivity)
* [History](/docs/examples/history)
* [Author](/docs/examples/author)
* [Regex](/docs/examples/regex)

### Rule Set

A **Rule Set** is a "grouped" set of `Rules` with a **trigger condition** specified. 

Rule Sets can be used interchangeably with other **Rules** and **Rule Sets** in the `rules` list of a **Check**. 

They allow you to create more complex trigger behavior by combining multiple rules into one "parent rule".

It consists of:

* **condition** -- Under what condition should the Rule Set be considered triggered?
  * `AND` -- ALL Rules in the Rule Set must **trigger** in order for the Rule Set to **trigger.**
  * `OR` -- ANY Rule in the Rule Set that is **triggered** will trigger the whole Rule Set.
* **rules** -- The **Rules** for the Rule Set.

Example
```json5
{
  "condition": "AND",
  "rules": [
    // all the rules go here
  ]
}
```
#### Rule Set Examples

* [**Detailed Example**](/docs/examples/advancedConcepts/ruleSets.json5)

### Action

An **Action** is some action the bot can take against the checked Activity (comment/submission) or Author of the Activity. CM has Actions for most things a normal reddit user or moderator can do.

#### Available Actions

* Remove (Comment/Submission)
* Flair (Submission)
* Ban (User)
* Approve (Comment/Submission)
* Comment (Reply to Comment/Submission)
* Lock (Comment/Submission)
* Report (Comment/Submission)
* [UserNote](/docs/examples/userNotes) (User, when /r/Toolbox is used)

For detailed explanation and options of what individual Actions can do [see the links in the `actions` property in the schema.](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json)

### Filters

**Checks, Rules, and Actions** all have two additional (optional) criteria "tests". These tests behave differently than rule/check triggers in that:

* When they **pass** the thing being tested continues to process as usual
* When they **fail** the thing being tested **is skipped, not failed.**

For **Checks** and **Actions** skipping means that the thing is not processed. The Action is not run, the Check is not triggered.

In the context of **Rules** (in a Check) skipping means the Rule does not get run BUT it does not fail. The Check will continue processing as if the Rule did not exist. However, if ALL Rules in a Check are skipped then the Check does "fail" (is not triggered).

#### Available Filters

##### Item Filter (`itemIs`)

This filter will test against the **state of the Activity currently being run.** Some criteria available to test against IE "Is the activity...":

* removed
* nsfw
* locked
* stickied
* deleted
* etc...

The `itemIs` filter is made up of an array (list) of `State` criteria objects. **All** criteria in the array must pass for this filter to pass.

There are two different State criteria depending on what type of Activity is being tested:

* Submission -- [SubmissionState](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FSubmissionState?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json)
* Comment -- [CommentState](https://json-schema.app/view/%23/%23%2Fdefinitions%2FCommentCheckJson/%23%2Fdefinitions%2FCommentState?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json)

##### Author Filter (`authorIs`)

This filter will test against the **Author of the Activity currently being run.** Some criteria available to test against:

* account age
* comment, link, and total karma
* subreddit flair text/css
* name
* User Notes
* verified
* etc...

The `authorIs` filter is made up two (optional) lists of [`AuthorCriteria`](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FAuthorOptions/%23%2Fdefinitions%2FAuthorCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) criteria objects that define how the test behaves:

* `include` list -- If **any** `AuthorCriteria` from this list passes then the `authorIs` test passes
* `exclude` list -- If **any** `AuthorCriteria` from this list **does not pass** then the `authorIs` test passes. **Note:** This property is ignored if `include` is also present IE you cannot use both properties at the same time.

Refer to the [app schema for `AuthorCriteria`](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FAuthorOptions/%23%2Fdefinitions%2FAuthorCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for all available properties to test against.

Some examples of using `authorIs` can be found in the [Author examples.](/docs/examples/author)

## Configuration And Usage

* For **Operator/Bot maintainers** see **[Operation Configuration](/docs/operatorConfiguration.md)**
  * [CLI Usage](docs/operatorConfiguration.md#cli-usage)
* For **Moderators** 
  * Refer to the [examples folder](/docs/examples) or the [subreddit-ready examples](/docs/examples/subredditReady)
  * as well as the [schema editor](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) which has
    * fully annotated configuration data/structure
    * generated examples in json/yaml
    * built-in editor that automatically validates your config

## Common Resources

Technical information on recurring, common data/patterns used in CM.

### Activities `window`

Most **Rules** must define the **range of Activities (submissions and/or comments)** that will be used to check the criteria of the Rule. This range is defined wherever you see a `window` property in configuration.

Refer to the [Activities Window](/docs/activitiesWindow.md) documentation for a technical explanation with examples.

### Thresholds and Comparisons

Most rules/filters have criteria that require you to define a specific condition to test against. This can be anything from repeats of activities to account age.

In all of these scenarios the condition is defined using a subset of [comparison operators](https://www.codecademy.com/articles/fwd-js-comparison-logical) (very similar to how automoderator does things).

Available operators:

* `<` -- **less than** => `5 < 6` => 5 is less than 6
* `>` -- **greater than** => `6 > 5` => 6 is greater than 5
* `<=` -- **less than or equal to** => `5 <= 5` => 5 is less than **or equal to** 5
* `>=` -- **greater than or equal to** => `5 >= 5` => 5 is greater than **or equal to** 5

In the context of a rule/filter comparison you provide the comparison **omitting** the value that is being tested. An example...

The RepeatActivity rule has a `threshold` comparison to test against the number of repeat activities it finds

* You want the rule to trigger if it finds **4 or more repeat activities**
* The rule would be configured like this `"threshold": ">= 4"`

Essentially what this is telling the rule is `threshold: "x >= 4"` where `x` is the largest repeat of activities it finds.

#### Other Comparison Types

Other than comparison numeric values there are two other values that can be compared (depending on the criteria)

##### Percentages

Some criteria accept an optional **percentage** to compare against:

```
"threshold": "> 20%"
```

Refer to the individual rule/criteria schema to see what this percentage is comparing against.

##### Durations

Some criteria accept an optional **duration** to compare against:

```
"threshold": "< 1 month"
```

The duration value compares a time range from **now** to `duration value` time in the past.

Refer to [duration values in activity window documentation](/docs/activitiesWindow.md#duration-values) as well as the individual rule/criteria schema to see what this duration is comparing against.

### Image Comparisons

ContextMod implements two methods for comparing **image content**, perceptual hashing and pixel-to-pixel comparisons. Comparisons can be used to filter activities in some activities.

See [image comparison documentation](/docs/imageComparison.md) for a full reference. 

## Best Practices

### Named Rules

All **Rules** in a subreddit's configuration can be assigned a **name** that can then be referenced from any other Check. 

Create general-use rules so they can be reused and de-clutter your configuration. Additionally, CM will automatically cache the result of a rule so there is a performance and api usage benefit to re-using Rules.

See [ruleNameReuse.json5](/docs/examples/advancedConcepts/ruleNameReuse.json5) for a detailed configuration with annotations.

### Check Order

Checks are run in the order they appear in your configuration, therefore you should place your highest requirement/severe action checks at the top and lowest requirement/moderate actions at the bottom.

This is so that if an Activity warrants a more serious reaction that Check is triggered first rather than having a lower requirement check with less severe actions triggered and causing all subsequent Checks to be skipped.

* Attribution >50% AND Repeat Activity 8x AND Recent Activity in 2 subs => remove submission + ban
* Attribution >20% AND Repeat Activity 4x AND Recent Activity in 5 subs => remove submission + flair user restricted
* Attribution >20% AND Repeat Activity 2x => remove submission
* Attribution >20% AND History comments <30% => remove submission
* Attribution >15% => report
* Repeat Activity 2x => report
* Recent Activity in 3 subs => report
* Author not vetted => flair new user submission

### Rule Order

The ordering of your Rules within a Check/RuleSet can have an impact on Check performance (speed) as well as API usage.

Consider these three rules:

* Rule A -- Recent Activity => 3 subreddits => last 15 submissions
* Rule B -- Repeat Activity => last 3 days
* Rule C -- Attribution => >10% => last 90 days or 300 submissions

The first two rules are lightweight in their requirements -- Rule A can be completed in 1 API call, Rule B potentially completed in 1 Api call.

However, depending on how active the Author is, Rule C will take *at least* 3 API calls just to get all activities (Reddit limit 100 items per call).

If the Check is using `AND` condition for its rules (default) then if either Rule A or Rule B fail then Rule C will never run. This means 3 API calls never made plus the time waiting for each to return.

**It is therefore advantageous to list your lightweight Rules first in each Check.**

### Caching

ContextMod implements caching functionality for:

* author history (`window` criteria in rules)
* `authorIs` results
* `content` that uses wiki pages (on Comment/Report/Ban Actions)
* and User Notes

All of these use api requests so caching them reduces api usage.

Cached results can be re-used if the criteria in configuration is identical to a previously cached result. So...

* author history cache results are re-used if **`window` criteria on a Rule is identical to the `window` on another Rule** IE always use **7 Days** or always use **50 Items** for absolute counts.
* `authorIs` criteria is identical to another `authorIs` elsewhere in configuration..
* etc...

Re-use will result in less API calls and faster Check times.

PROTIP: You can monitor the re-use of cache in the `Cache` section of your subreddit on the web interface. See the tooltips in that section for a better breakdown of cache statistics.

## FAQ

TODO
