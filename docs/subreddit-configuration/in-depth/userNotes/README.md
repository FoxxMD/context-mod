---
grand_parent: Subreddit Configuration
parent: In Depth
---

# User Notes

# [Toolbox](https://www.reddit.com/r/toolbox/wiki/docs) [User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes)

Context Mod supports reading and writing [User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) for the [Toolbox](https://www.reddit.com/r/toolbox/wiki/docs) extension.

**You must have Toolbox setup for your subreddit and at least one User Note created before you can use User Notes related features on Context Bot.** 

[Click here for the Toolbox Quickstart Guide](https://www.reddit.com/r/toolbox/wiki/docs/quick_start)

Valid Note Types:

* `gooduser`
* `spamwatch`
* `spamwarn`
* `abusewarn`
* `ban`
* `permban`
* `botban`

## Filter

User Notes are an additional criteria on [AuthorCriteria](https://json-schema.app/view/%23%2Fdefinitions%2FAuthorCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) that can be used alongside other Author properties for both [filtering rules and in the AuthorRule.](../author)

Consult the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FUserNoteCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the **UserNoteCriteria** object that can be used in AuthorCriteria.

### Examples

* Do not tag user with Good User note [JSON](usernoteFilter.json5) | [YAML](usernoteFilter.yaml)

## Action

A User Note can also be added to the Author of a Submission or Comment with the [UserNoteAction.](https://json-schema.app/view/%23%2Fdefinitions%2FUserNoteActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json)


### Examples

* Add note on user doing self promotion [JSON](usernoteSP.json5) | [YAML](usernoteSP.yaml)
