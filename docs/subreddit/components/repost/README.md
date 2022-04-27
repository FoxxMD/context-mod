The **Repost** rule is used to find reposts for both **Submissions** and **Comments**, depending on what type of **Check** it is used on.

Note: This rule is for searching **all of Reddit** for reposts, as opposed to just the Author of the Activity being checked. If you only want to check for reposts by the Author of the Activity being checked you should use the [Repeat Activity](/docs/subreddit/componentscomponents/repeatActivity) rule.

# TLDR

Out of the box CM generates a repost rule with sensible default behavior without any configuration. You do not need to configure any of below options (facets, modifiers, criteria) yourself in order to have a working repost rule. Default behavior is as follows...

* When looking for Submission reposts CM will find any Submissions with 
  * a very similar title 
  * or independent of title...
     * any crossposts/duplicates
     * any submissions with the exact URL
* When looking for Comment reposts CM will do the above AND THEN 
  * compare the top 50 most-upvoted comments from the top 10 most-upvoted Submissions against the comment being checked
  * compare any items found from external source (Youtube comments, etc...) against the comment being checked

# Configuration

## Search Facets

ContextMod has several ways to search for reposts -- all of which look at different elements of a Submission in order to find repost candidates. You can define any/all of these **Search Facets** you want to use to search Reddit inside the configuration for the Repost Rule in the `searchOn` property.

### Usage

Facets are specified in the `searchOn` array property within the rule's configuration.

**String**

Specify one or more types of facets as a string to use their default configurations

<details>

YAML
```yaml
kind: repost
criteria:
  - searchOn:
      - title
      - url
      - crossposts
```

JSON
```json5
{
  "kind": "repost",
  "criteria": [
    {
      // ...
      "searchOn": ["title", "url", "crossposts"],
      // ....
    }
  ]
}

```

</details>

**Object**

**string** and object configurations can be mixed

<details>

```yaml
kind: repost
criteria:
  - searchOn:
      - title
      - kind: url
        matchScore: 90
      - external
```

```json5
{
  "kind": "repost",
  "criteria": [
    {
      // ...
      "searchOn": [
        "title",
        {
          "kind": "url",
          // could also specify multiple types to use the same config for all
          //"kind": ["url", "duplicates"]
          "matchScore": 90,
          //...
        },
        "external"
      ],
      // ....
    }
  ]
}

```

</details>

### Facet Types

* **title** -- search reddit for Submissions with a similar title
* **url** -- search reddit for Submissions with the same URL
* **duplicates** -- get all Submissions **reddit has identified** as duplicates that are **NOT** crossposts
  * these are found under *View discussions in other communities* (new reddit) or *other discussions* (old reddit) on the Submission
* **crossposts** -- get all Submissions where the current Submission is the source of an **official** crosspost
  * this differs from duplicates in that crossposts use reddit's built-in crosspost functionality, respect subreddit crosspost rules, and link back to the original Submission
* **external** -- get items from the Submission's link source that may be reposted (currently implemented for **Comment Checks** only)
  * When the Submission link is for...
    * **Youtube** -- get top comments on video by replies/like count
      * **NOTE:** An **API Key** for the [Youtube Data API](https://developers.google.com/youtube/v3) must be provided for this facet to work. This can be provided by the operator alongside [bot credentials](/docs/operator/configuration.md) or in the top-level `credentials` property for a [subreddit configuration.](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)

### Facet Modifiers

For all **Facets**, except for **external**, there are options that be configured to determine if the found Submissions is a "valid" repost IE filtering. These options can be configured **per facet**.

* **matchScore** -- The percentage, as a whole number, of a repost title that must match the title being checked in order to consider both a match
* **minWordCount** -- The minimum number of words a title must have
* **caseSensitive** -- If the match comparison should be case-sensitive (defaults to `false`)

Additionally, the current Activity's title and/or each repost's title can be transformed before matching:

* **transformations** -- An array of SearchAndReplace objects used to transform the repost's title
* **transformationsActivity** -- An array of SearchAndReplace objects used to transform the current Activity's title

#### Modifier Defaults

To make facets easier to use without configuration sensible defaults are applied to each when no other configuration is defined...

* **title**
  * `matchScore: 85` -- The candidate repost's title must be at least 85% similar to the current Activity's title
  * `minWordCount: 2` --  The candidate repost's title must have at least 2 words

For `url`,`duplicates`, and `crossposts` the only default is `matchScore: 0` because the assumption is you want to treat any actual dups/x-posts or exact URLs as reposts, regardless of their title.

## Additional Criteria Properties

A **criteria** object may also specify some additional tests to run against the reposts found from searching.

### For Submissions and Comments

#### Occurrences

Define a set of criteria to test against the **number of reposts**, **time reposts were created**, or both.

##### Count

<details>

```yaml
kind: repost
criteria:
  - searchOn:
      - title
      - url
      - crossposts
    occurrences:
      criteria:
        - count:
            condition: AND
            test:
              - '> 3'
              - <= 5
```

```json5
{
  "kind": "repost",
  "criteria": [
    {
      // ...
      "searchOn": ["title", "url", "crossposts"],
      "occurrences": {
        "criteria": [
          {
            // passes if BOTH tests are true
            "count": {
              "condition": "AND", // default is AND
              "test": [
                "> 3", // TRUE if there are GREATER THAN 3 reposts found
                "<= 5" // TRUE if there are LESS THAN OR EQUAL TO 5 reposts found
              ]
            }
          }
        ],
      }
    }
  ]
}
```

</details>

##### Time

Define a test or array of tests to run against **when reposts were created**

<details>

```yaml
kind: repost
criteria:
  - searchOn:
      - title
      - url
      - crossposts
    occurrences:
      criteria:
        - time:
            condition: AND
            test:
              - testOn: all
                condition: '> 3 months'
```

```json5
{
  "kind": "repost",
  "criteria": [
    {
      // ...
      "searchOn": [
        "title",
        "url",
        "crossposts"
      ],
      "occurrences": {
        "criteria": [
          {
            time: {
              // how to test array of comparisons. AND => all must pass, OR => any must pass
              "condition": "AND",
              "test": [
                {
                  // which of the found reposts to test the time comparison on
                  //
                  // "all"    => ALL reposts must pass time comparison
                  // "any"    => ANY repost must pass time comparison
                  // "newest" => The newest (closest in time to now) repost must pass time comparison
                  // "oldest" => The oldest (furthest in time from now) repost must pass time comparison
                  //
                  "testOn": "all",
                  // Tested items must be OLDER THAN 3 months
                  "condition": "> 3 months"
                }
              ]
            }
          }
        ]
      },
    }
  ]
}
```

</details>


### For Comments

When the rule is run in a **Comment Check** you may specify text comparisons (like those found in Search Facets) to run on the contents of the repost comments *against* the contents of the comment being checked.

* **matchScore** -- The percentage, as a whole number, of a repost comment that must match the comment being checked in order to consider both a match (defaults to 85% IE `85`)
* **minWordCount** -- The minimum number of words a comment must have
* **caseSensitive** -- If the match comparison should be case-sensitive (defaults to `false`)

# Examples

Examples of a *full* CM configuration, including the Repost Rule, in various scenarios. In each scenario the parts of the configuration that affect the rule are indicated.

## Submissions

When the Repost Rule is run on a **Submission Check** IE the activity being checked is a Submission.

### Default Behavior (No configuration)

This is the same behavior described in the [TLDR](#TLDR) section above -- find any submissions with:

* a very similar title (85% or more the same)
* or ignoring title...
  * any crossposts/duplicates
  * any submissions with the exact URL

<details>

```yaml
polling:
  - unmoderated
checks:
  - name: subRepost
    description: Check if submission has been reposted
    kind: submission
    condition: AND
    rules:
      - kind: repost
    actions:
      - kind: report
        content: This submission was reposted
```

```json5
{
  "polling": [
    "unmoderated"
  ],
  "checks": [
    {
      "name": "subRepost",
      "description": "Check if submission has been reposted",
      // kind specifies this check is for SUBMISSIONS
      "kind": "submission",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost"
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This submission was reposted"
        }
      ]
    }
  ]
}

```

</details>

### Search by Title Only

Find any submissions with:

* a very similar title (85% or more the same)

<details>

```yaml
polling:
  - unmoderated
checks:
  - name: subRepost
    description: Check if submission has been reposted
    kind: submission
    condition: AND
    rules:
      - kind: repost
        criteria:
          - searchOn:
              - title
    actions:
      - kind: report
        content: This submission was reposted
```

```json5
{
  "polling": [
    "unmoderated"
  ],
  "checks": [
    {
      "name": "subRepost",
      "description": "Check if submission has been reposted",
      // kind specifies this check is for SUBMISSIONS
      "kind": "submission",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost",
          "criteria": [
            {
              // specify only title to search on
              "searchOn": [
                "title" // uses default configuration since only string is specified
              ]
            }
          ]
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This submission was reposted"
        }
      ]
    }
  ]
}

```

</details>

### Search by Title only and specify similarity percentage

* a very similar title (95% or more the same)

<details>

```yaml
polling:
  - unmoderated
checks:
  - name: subRepost
    description: Check if submission has been reposted
    kind: submission
    condition: AND
    rules:
      - kind: repost
        criteria:
          - searchOn:
              - kind: title
                matchScore: '95'
    actions:
      - kind: report
        content: This submission was reposted
```

```json5
{
  "polling": [
    "unmoderated"
  ],
  "checks": [
    {
      "name": "subRepost",
      "description": "Check if submission has been reposted",
      // kind specifies this check is for SUBMISSIONS
      "kind": "submission",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost",
          "criteria": [
            {
              // specify only title to search on
              "searchOn": [
                {
                  "kind": "title",
                  // titles must be 95% or more similar
                  "matchScore": "95"
                }
              ]
            }
          ]
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This submission was reposted"
        }
      ]
    }
  ]
}

```

</details>

### Search by Title, specify similarity percentage, AND any duplicates

<details>

```yaml
polling:
  - unmoderated
checks:
  - name: subRepost
    description: Check if submission has been reposted
    kind: submission
    condition: AND
    rules:
      - kind: repost
        criteria:
          - searchOn:
              - duplicates
              - kind: title
                matchScore: '95'
    actions:
      - kind: report
        content: This submission was reposted
```

```json5
{
  "polling": [
    "unmoderated"
  ],
  "checks": [
    {
      "name": "subRepost",
      "description": "Check if submission has been reposted",
      // kind specifies this check is for SUBMISSIONS
      "kind": "submission",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost",
          "criteria": [
            {
              "searchOn": [
                // look for duplicates (NON crossposts) using default configuration
                "duplicates",
                // search by title
                {
                  "kind": "title",
                  // titles must be 95% or more similar
                  "matchScore": "95"
                }
              ]
            }
          ]
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This submission was reposted"
        }
      ]
    }
  ]
}
```

</details>

### Approve Submission if not reposted in the last month, by title

<details>

```yaml
polling:
  - unmoderated
checks:
  - name: subRepost
    description: Check there are no reposts with same title in the last month
    kind: submission
    condition: AND
    rules:
      - kind: repost
        criteria:
          - searchOn:
              - title
            occurrences:
              condition: OR
              criteria:
                - count:
                    test:
                      - < 1
                - time:
                    test:
                      - testOn: newest
                        condition: '> 1 month'
    actions:
      - kind: approve
```

```json5
{
  "polling": [
    "unmoderated"
  ],
  "checks": [
    {
      "name": "subRepost",
      "description": "Check there are no reposts with same title in the last month",
      // kind specifies this check is for SUBMISSIONS
      "kind": "submission",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost",
          "criteria": [
            {
              "searchOn": [
                "title"
              ],
              "occurrences": {
                // if EITHER criteria is TRUE then it "passes"
                "condition": "OR",
                "criteria": [
                  // first criteria:
                  // TRUE if there are LESS THAN 1 reposts (no reposts found)
                  {
                    "count": {
                      "test": ["< 1"]
                    }
                  },
                  // second criteria:
                  // TRUE if the newest repost is older than one month
                  {
                    "time": {
                      "test": [
                        {
                          "testOn": "newest",
                          "condition": "> 1 month"
                        }
                      ]
                    }
                  }
                ]
              },
            }
          ]
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          // approve this post since we know it is not a repost of anything within the last month
          "kind": "approve",
        }
      ]
    }
  ]
}

```

</details>


## Comments

### Default Behavior (No configuration)

This is the same behavior described in the [TLDR](#TLDR) section above -- find any submissions with:

* a very similar title (85% or more the same)
* or ignoring title...
  * any crossposts/duplicates
  * any submissions with the exact URL
* If comment being checked is on a Submission for Youtube then get top 50 comments on youtube video as well...

AND THEN

* sort submissions by votes
* take top 20 (upvoted) comments from top 10 (upvoted) submissions
* sort comments by votes, take top 50 + top 50 external items

FINALLY

* filter all gathered comments by default `matchScore: 85` to find very similar matches
* rules is triggered if any are found

<details>

```yaml
polling:
  - newComm
checks:
  - name: commRepost
    description: Check if comment has been reposted
    kind: common
    condition: AND
    rules:
      - kind: repost
    actions:
      - kind: report
        content: This comment was reposted
```

```json5
{
  "polling": [
    "newComm"
  ],
  "checks": [
    {
      "name": "commRepost",
      "description": "Check if comment has been reposted",
      // kind specifies this check is for COMMENTS
      "kind": "common",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost"
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This comment was reposted"
        }
      ]
    }
  ]
}

```

</details>

### Search by external (youtube) comments only

<details>

```yaml
polling:
  - newComm
checks:
  - name: commRepost
    description: Check if comment has been reposted from youtube
    kind: comment
    condition: AND
    rules:
      - kind: repost
        criteria:
          - searchOn:
              - external
    actions:
      - kind: report
        content: This comment was reposted from youtube
```

```json5
{
  "polling": [
    "newComm"
  ],
  "checks": [
    {
      "name": "commRepost",
      "description": "Check if comment has been reposted from youtube",
      // kind specifies this check is for SUBMISSIONS
      "kind": "comment",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost",
          "criteria": [
            {
              // specify only external (youtube) to search on
              "searchOn": [
                "external"
              ]
            }
          ]
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This comment was reposted from youtube"
        }
      ]
    }
  ]
}

```

</details>

### Search by external (youtube) comments only, with higher comment match percentage

<details>

```yaml
polling:
  - newComm
checks:
  - name: commRepost
    description: Check if comment has been reposted from youtube
    kind: comment
    condition: AND
    rules:
      - kind: repost
        criteria:
          - searchOn:
              - external
            matchScore: 95
    actions:
      - kind: report
        content: This comment was reposted from youtube
```

```json5
{
  "polling": [
    "newComm"
  ],
  "checks": [
    {
      "name": "commRepost",
      "description": "Check if comment has been reposted from youtube",
      // kind specifies this check is for SUBMISSIONS
      "kind": "comment",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost",
          "criteria": [
            {
              // specify only external (youtube) to search on
              "searchOn": [
                "external"
              ],
              "matchScore": 95 // matchScore for comments is on criteria instead of searchOn config...
            },
          ]
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This comment was reposted from youtube"
        }
      ]
    }
  ]
}

```

</details>

### Search by external (youtube) comments and submission URL, with higher comment match percentage

<details>

```yaml
polling:
  - newComm
checks:
  - name: commRepost
    description: Check if comment has been reposted
    kind: comment
    condition: AND
    rules:
      - kind: repost
        criteria:
          - searchOn:
              - external
              - url
            matchScore: 95
    actions:
      - kind: report
        content: >-
          This comment was reposted from youtube or from submission with the
          same URL
```

```json5
{
  "polling": [
    "newComm"
  ],
  "checks": [
    {
      "name": "commRepost",
      "description": "Check if comment has been reposted",
      // kind specifies this check is for SUBMISSIONS
      "kind": "comment",
      "condition": "AND",
      "rules": [
        // repost rule configuration is below
        //
        {
          "kind": "repost",
          "criteria": [
            {
              // specify only external (youtube) to search on
              "searchOn": [
                "external",
                // can specify any/all submission search facets to acquire comments from
                "url"
              ],
              "matchScore": 95 // matchScore for comments is on criteria instead of searchOn config...
            },
          ]
        },
        // 
        // repost rule configuration is above
      ],
      "actions": [
        {
          "kind": "report",
          "content": "This comment was reposted from youtube or from submission with the same URL"
        }
      ]
    }
  ]
}
```

</details>
