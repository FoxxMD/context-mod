# History

The **History** rule can check an Author's submission/comment statistics over a time period:
* Submission total or percentage of All Activity
* Comment total or percentage of all Activity
* Comments made as OP (commented in their own Submission) total or percentage of all Comments

Consult the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FHistoryJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

### Examples

* [Low Comment Engagement](/examples/history/lowEngagement.json5) - Check if Author is submitting much more than they comment.
* [Submission is in Free Karma Subreddits](/examples/recentActivity/freeKarmaOnSubmission.json5) - Check if Author is mostly engaging only in their own content
