---
grand_parent: Subreddit Configuration
parent: In Depth
---

# History Rule

The **History** rule can check an Author's submission/comment statistics over a time period:

* Submission total or percentage of All Activity
* Comment total or percentage of all Activity
* Comments made as OP (commented in their own Submission) total or percentage of all Comments
* Ratio of activities against another window of activities

Consult the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FHistoryJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

## Ratio

Use the `ratio` property in Criteria to test the [number of activities](../../activitiesWindow.md) found in the parent criteria against the number of activities from _another_ [activity window](../../activitiesWindow.md) defined in the ratio.

Example:

```yaml
- kind: history
  criteria:
    # "parent" criteria, returns all activities, in the last 100 from user's history, that occurred in r/mealtimevideos
    - window:
        count: 100
        filterOn:
          post:
            subreddits:
              include:
                - mealtimevideos
      ratio:
        # "ratio" criteria, returns all activities, in the last 100 from user's history, that occurred in r/redditdev
        window:
          count: 100
          filterOn:
            post:
              subreddits:
                include:
                  - redditdev
        # test (number of parent criteria activities) / (number of ratio critieria activities)
        threshold: '> 1.2'
```

`threshold` may be a number or percentage `(number * 100)`

* EX `> 1.2`  => There are 1.2 activities from parent criteria for every 1 ratio activities
* EX `<= 75%` => There are equal to or less than 0.75 activities from parent criteria for every 1 ratio activities

### Examples

* Low Comment Engagement [YAML](lowEngagement.yaml) | [JSON](lowEngagement.json5) - Check if Author is submitting much more than they comment.
* OP Comment Engagement [YAML](opOnlyEngagement.yaml) | [JSON](opOnlyEngagement.json5) - Check if Author is mostly engaging only in their own content

# [Template Variables](../../actionTemplating.md)

|         Name         |                              Description                               |                      Example                       |
|----------------------|------------------------------------------------------------------------|----------------------------------------------------|
| `result`             | Summary of rule results (also found in Actioned Events)                | Filtered Activities (7) were < 10 Items (2 months) |
| `activityTotal`      | Total number of activities from window                                 | 50                                                 |
| `filteredTotal`      | Total number of activities filtered from window                        | 7                                                  |
| `filteredPercent`    | Percentage of activities filtered from window                          | 14%                                                |
| `submissionTotal`    | Total number of filtered submissions from window                       | 4                                                  |
| `submissionPercent`  | Percentage of filtered submissions from window                         | 8%                                                 |
| `commentTotal`       | Total number of filtered comments from window                          | 3                                                  |
| `commentPercent`     | Percentage of filtered comments from window                            | 6%                                                 |
| `opTotal`            | Total number of comments as OP from filtered comments                  | 2                                                  |
| `opPercent`          | Percentage of comments as OP from filtered comments                    | 66%                                                |
| `thresholdSummary`   | A text summary of the first Criteria triggered with totals/percentages | Filtered Activities (7) were < 10 Items            |
| `subredditBreakdown` | A markdown list of filtered activities by subreddit                    | * SubredditA - 5 (71%) \n * Subreddit B - 2 (28%)  |
| `window`             | Number or duration of Activities considered from window                | 2 months                                           |
