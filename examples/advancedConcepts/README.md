### Named Rules

See [ruleNameReuse.json5](/examples/advancedConcepts/ruleNameReuse.json5)

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

### Rule Sets

The `rules` array on a `Checks` can contain both `Rule` objects and `RuleSet` objects.

A **Rule Set** is a "nested" set of `Rule` objects with a passing condition specified. These allow you to create more complex trigger behavior by combining multiple rules. 

See **[ruleSets.json5](/examples/advancedConcepts/ruleSets.json5)** for a complete example as well as consulting the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FRuleSetJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json).
