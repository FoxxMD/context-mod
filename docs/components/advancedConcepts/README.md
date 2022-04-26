### Named Rules

See **Rule Name Reuse Examples [YAML](/docs/components/advancedConcepts/ruleNameReuse.yaml) | [JSON](/docs/components/advancedConcepts/ruleNameReuse.json5)**

### Check Order and Flow Control

Checks are run in the order they appear in your configuration, therefore you should place your highest requirement/severe action checks at the top and lowest requirement/moderate actions at the bottom.

This is so that if an Activity warrants a more serious reaction that Check is triggered first rather than having a lower requirement check with less severe actions triggered and causing all subsequent Checks to be skipped. 

This behavior can also be controlled modified using [Flow Control](/docs/components/advancedConcepts/flowControl.md)

* Attribution >50% AND Repeat Activity 8x AND Recent Activity in 2 subs => remove submission + ban
* Attribution >20% AND Repeat Activity 4x AND Recent Activity in 5 subs => remove submission + flair user restricted
* Attribution >20% AND Repeat Activity 2x => remove submission
* Attribution >20% AND History comments <30% => remove submission
* Attribution >15% => report
* Repeat Activity 2x => report
* Recent Activity in 3 subs => report
* Author not vetted => flair new user submission

### Rule Sets

The `rules` array on a `Checks` can contain both `Rule` objects and `RuleSet` objects.

A **Rule Set** is a "nested" set of `Rule` objects with a passing condition specified. These allow you to create more complex trigger behavior by combining multiple rules. 

See **ruleSets [YAML](/docs/components/advancedConcepts/ruleSets.yaml) | [JSON](/docs/components/advancedConcepts/ruleSets.json5)** for a complete example as well as consulting the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FRuleSetJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json).

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

Context Mod implements some basic caching functionality for **Author Activities** and wiki pages (on Comment/Report Actions).

**Author Activities** are cached for a subreddit-configurable amount of time (10 seconds by default). A cached activities set can be re-used if the **window on a Rule is identical to the window on another Rule**.

This means that when possible you should re-use window values. 

IE If you want to check an Author's Activities for a time range try to always use **7 Days** or always use **50 Items** for absolute counts.

Re-use will result in less API calls and faster Check times.
