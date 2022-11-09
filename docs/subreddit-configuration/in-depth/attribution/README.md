---
grand_parent: Subreddit Configuration
parent: In Depth
---

# Attribution Rule

The **Attribution** rule will aggregate an Author's content Attribution (youtube channels, twitter, website domains, etc.) and can check on their totals or percentages of all Activities over a time period:
* Total # of attributions 
* As percentage of all Activity or only Submissions
* Look at all domains or only media (youtube, vimeo, etc.)
* Include self posts (by reddit domain) or not

Consult the [schema](https://json-schema.app/view/%23/%23%2Fdefinitions%2FCheckJson/%23%2Fdefinitions%2FAttributionJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

# [Template Variables](/docs/moderators/actionTemplating.md)

|          Name          |                                                                      Description                                                                       |                                          Example                                          |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| `result`               | Summary of rule results (also found in Actioned Events)                                                                                                | 1 Attribution(s) met the threshold of >= 20%, with 6 (40%) of 15 Total -- window: 3 years |
| `triggeredDomainCount` | Number of domains that met the threshold                                                                                                               | 1                                                                                         |
| `window`               | Number or duration of Activities considered from window                                                                                                | 3 years                                                                                   |
| `largestCount`         | The count from the largest aggregated domain                                                                                                           | 6                                                                                         |
| `largestPercentage`    | The percentage of Activities the largest aggregated domain comprises                                                                                   | 40%                                                                                       |
| `smallestCount`        | The count from the smallest aggregated domain                                                                                                          | 1                                                                                         |
| `smallestPercentage`   | The percentage of Activities the smallest aggregated domain comprises                                                                                  | 6%                                                                                        |
| `countRange`           | A convenience string displaying "smallestCount - largestCount" or just one number if both are the same                                                 | 5                                                                                         |
| `percentRange`         | A convenience string displaying "smallestPercentage - largestPercentage" or just one percentage if both are the same                                   | 34%                                                                                       |
| `domainsDelim`         | A comma-delimited list of all the domain URLs that met the threshold                                                                                   | youtube.com/example1, youtube.com/example2, rueters.com                                   |
| `titlesDelim`          | A comma-delimited list of friendly-names of the domain if one is present, otherwise the URL (IE youtube.com/c/34ldfa343 => "My Youtube Channel Title") | My Channel A, My Channel B, reuters.com                                                   |
| `threshold`            | The threshold you configured for this Rule to trigger                                                                                                  | `>= 20%`                                                                                  |

# Examples

* Self Promotion as percentage of all Activities [YAML](/docs/moderators/components/attribution/redditSelfPromoAll.yaml) | [JSON](/docs/moderators/components/attribution/redditSelfPromoAll.json5) - Check if Author is submitting much more than they comment.
* Self Promotion as percentage of Submissions [YAML](/docs/moderators/components/attribution/redditSelfPromoSubmissionsOnly.yaml) | [JSON](/docs/examplesm/attribution/redditSelfPromoSubmissionsOnly.json5) - Check if any of Author's aggregated submission origins are >10% of their submissions
