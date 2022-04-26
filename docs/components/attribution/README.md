# Attribution

The **Attribution** rule will aggregate an Author's content Attribution (youtube channels, twitter, website domains, etc.) and can check on their totals or percentages of all Activities over a time period:
* Total # of attributions 
* As percentage of all Activity or only Submissions
* Look at all domains or only media (youtube, vimeo, etc.)
* Include self posts (by reddit domain) or not

Consult the [schema](https://json-schema.app/view/%23/%23%2Fdefinitions%2FCheckJson/%23%2Fdefinitions%2FAttributionJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

### Examples

* Self Promotion as percentage of all Activities [YAML](/docs/components/attribution/redditSelfPromoAll.yaml) | [JSON](/docs/components/attribution/redditSelfPromoAll.json5) - Check if Author is submitting much more than they comment.
* Self Promotion as percentage of Submissions [YAML](/docs/components/attribution/redditSelfPromoSubmissionsOnly.yaml) | [JSON](/docs/examplesm/attribution/redditSelfPromoSubmissionsOnly.json5) - Check if any of Author's aggregated submission origins are >10% of their submissions
