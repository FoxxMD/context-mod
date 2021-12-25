# History

The **History** rule can check an Author's submission/comment statistics over a time period:
* Submission total or percentage of All Activity
* Comment total or percentage of all Activity
* Comments made as OP (commented in their own Submission) total or percentage of all Comments

Consult the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FHistoryJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

### Examples

* Low Comment Engagement [YAML](/docs/examples/history/lowEngagement.yaml) | [JSON](/docs/examples/history/lowEngagement.json5) - Check if Author is submitting much more than they comment.
* OP Comment Engagement [YAML](/docs/examples/history/opOnlyEngagement.yaml) | [JSON](/docs/examples/history/opOnlyEngagement.json5) - Check if Author is mostly engaging only in their own content
