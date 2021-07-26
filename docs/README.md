# Documentation

# Table of Contents

* [Getting Started](#getting-started)
* [How It Works](#how-it-works)
* [Concepts](#concepts)
  * [Rule](#rule)
    * [Examples](#available-rules)
  * [Rule Set](#rule-set)
    * [Examples](#rule-set-examples)
  * [Action](#action)
    * [Examples](#available-actions)
  * [Filters](#filters)
* [Configuration](#configuration)
* [Common Resources](#common-resources)
  * [Activities `window`](#activities-window)
  * [Comparisons](#thresholds-and-comparisons)
* [Best Practices](#best-practices)
* [Subreddit-ready Configurations](#subreddit-ready-configurations)
* FAQ

## Getting Started

Review **at least** the **How It Works** and **Concepts** below and then head to the [**Getting Started documentation.**](/docs/gettingStarted.md)

## How It Works

Where possible Reddit Context Bot (RCB) uses the same terminology as, and emulates the behavior, of **automoderator** so if you are familiar with that much of this may seem familiar to you.

RCB's lifecycle looks like this:

#### 1) A new event in your subreddit is received by RCB

The events RCB watches for are configured by you. These can be new modqueue items, submissions, or comments.

#### 2) RCB sequentially processes each Check in your configuration

A **Check** is a set of:

* One or more **Rules** that define what conditions should **trigger** this Check
* One or more **Actions** that define what the bot should do once the Check is **triggered**

#### 3) Each Check is processed, *in order*, until a Check is triggered

Once a Check is **triggered** no more Checks will be processed. This means all subsequent Checks in your configuration (in the order you listed them) are basically skipped.

#### 4) All Actions from that Check are executed

After all Actions are executed RCB returns to waiting for the next Event.

## Concepts

Core, high-level concepts regarding how RCB works.

### Checks

TODO

### Rule

A **Rule** is some set of **criteria** (conditions) that are tested against an Activity (comment/submission), a User, or a User's history. A Rule is considered **triggered** when the **criteria** for that rule are found to be **true** for whatever is being tested against.

There are generally three main properties for a Rule:

* **Critiera** -- The conditions/values you want to test for.
* **Activities Window** -- If applicable, the range of activities that the **criteria** will be tested against.
* **Rule-specific options** -- Any number of options that modify how the **criteria** are tested.

RCB has different **Rules** that can test against different types of behavior and aspects of a User, their history, and the Activity (submission/common) being checked.

#### Available Rules
Find detailed descriptions of all the Rules, with examples, below:

* [Attribution](/docs/examples/attribution)
* [Recent Activity](/docs/examples/recentActivity)
* [Repeat Activity](/docs/examples/repeatActivity)
* [History](/docs/examples/history)
* [Author](/docs/examples/author)

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

An **Action** is some action the bot can take against the checked Activity (comment/submission) or Author of the Activity. RCB has Actions for most things a normal reddit user or moderator can do.

### Available Actions

* Remove (Comment/Submission)
* Flair (Submission)
* Ban (User)
* Approve (Comment/Submission)
* Comment (Reply to Comment/Submission)
* Lock (Comment/Submission)
* Report (Comment/Submission)
* [UserNote](/docs/examples/userNotes) (User, when /r/Toolbox is used)

For detailed explanation and options of what individual Actions can do [see the links in the `actions` property in the schema.](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)

### Filters

TODO

## Configuration

* For **Operator/Bot maintainers** see **[Operation Configuration](/docs/operatorConfiguration.md)**
* For **Moderators** see the [App Schema](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json) and [examples](/docs/examples)

## Common Resources

Technical information on recurring, common data/patterns used in RCB.

### Activities `window`

Most **Rules** must define the **range of Activities (submissions and/or comments)** that will be used to check the criteria of the Rule. This range is defined wherever you see a `window` property in configuration.

Refer to the [Activities Window](/docs/activitiesWindow.md) documentation for a technical explanation with examples.

### Thresholds and Comparisons

TODO

## Best Practices

### Named Rules

All **Rules** in a subreddit's configuration can be assigned a **name** that can then be referenced from any other Check. 

Create general-use rules so they can be reused and de-clutter your configuration. Additionally RCB will automatically cache the result of a rule so there is a performance and api usage benefit to re-using Rules.

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

### API Caching

Context bot implements some basic caching functionality for **Author Activities** and wiki pages (on Comment/Report Actions).

**Author Activities** are cached for a subreddit-configurable amount of time (10 seconds by default). A cached activities set can be re-used if the **window on a Rule is identical to the window on another Rule**.

This means that when possible you should re-use window values.

IE If you want to check an Author's Activities for a time range try to always use **7 Days** or always use **50 Items** for absolute counts.

Re-use will result in less API calls and faster Check times.


## Subreddit-ready Configurations

TODO

## FAQ

TODO
