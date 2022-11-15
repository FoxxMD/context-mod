---
grand_parent: Subreddit Configuration
parent: In Depth
title: Filters
---
# Table of Contents

* [Filters](#filters)
  * [Criteria](#criteria)
  * [Filter Shapes](#filter-shapes)
    * [Simple Object](#simple-object)
    * [Simple List](#simple-list)
  * [Filter Types](#filter-types)
    * [Author Filter](#author-filter)
      * [Mod Actions/Notes Filter](#mod-actionsnotes-filter)
      * [Toolbox UserNotes Filter](#toolbox-usernotes-filter)
    * [Item Filter](#item-filter)
    * [Subreddit Filter](#subreddit-filter)
  * [Named Filters](#named-filters)
* [Examples](#examples)
  * [General Usage](#general-usage)
    * [Usage in a Run](#usage-in-a-run)
    * [Usage in a Check](#usage-in-a-check)
    * [Usage in a Rule](#usage-in-a-rule)
    * [Usage in an Action](#usage-in-an-action)
    * [Using Author and Item Filter](#using-author-and-item-filter)
  * [Filter Shapes Usage](#filter-shapes-usage)
    * [Using a Simple Object](#using-a-simple-object)
    * [Using a Simple List](#using-a-simple-list)
    * [Using a Full Anonymous Filter](#using-a-full-anonymous-filter)
    * [Using a Full Anonymous Filter with Exclude](#using-a-full-anonymous-filter-with-exclude)
    * [Using a Full Named Filter](#using-a-full-named-filter)
  * [Author Filter Examples](#author-filter-examples)
    * [New User](#new-user)
    * [New User with pattern in Name](#new-user-with-pattern-in-name)
    * [User has pattern in their profile description](#user-has-pattern-in-their-profile-description)
    * [Exclude moderators AND users by name](#exclude-moderators-and-users-by-name)
  * [Item Filter Examples](#item-filter-examples)
    * [Unmoderated comment by non-op](#unmoderated-comment-by-non-op)
    * [Submission is self post with no flair](#submission-is-self-post-with-no-flair)
  
# Filters

**Filters** are an additional channel for determining if an Event should be processed by ContextMod. They differ from [**Rules**](../../README.md#rules) in several key ways:

* **Runs, Checks, Rules, and Actions** can **all** have Filters
* Filters test against the **current state** of the Activity (or its Author) being processed, rather than looking at history/context/etc...
* Filter test results only determine if the Run, Check, Rule, or Action **should run** -- rather than triggering it
    * When the filter test **passes** the thing being tested continues to process as usual
    * When the filter test **fails** the thing being tested **fails**.

A Filter has these properties:

* `include` -- An optional list of Filter Criteria. If **any** passes the filter passes.
* `exclude` -- An optional list of Filter Criteria. All **must NOT** pass for the filter to pass. Ignored if `include` is present.
* `excludeCondition` -- A [condition](../../README.md#conditions) that determines how the list of Filter Criteria are tested together

## Criteria

A **criteria** is some property of a thing (Activity or Author) can be tested, and what the expected outcome is EX:

`age: '> 2 months'` => Author is older than 2 months

**Filter Criteria** is one of more **criteria** combined together to form a set of conditions that must all be true together for the Filter Criteria to be true EX

```yaml
age: '> 2 months'
verified: true
```

The above Filter Criteria is true if:

* the Author's account is older than 2 months AND
* they have a verified email

## Filter Shapes

Generically, a "full" Filter looks like this:

```yaml
include: #optional
  - name: AFilterCriteria
    criteria:
      #...
  #...one or more Filter Criteria

exclude: #optional
  #...one or more Filter Criteria

excludeCondition: OR or AND
```

But for convenience a Filter's shape can be simplified with a few assumptions:

### Simple Object

When a Filter is an object, the object is assumed to be a [Filter Criteria](#criteria) which is used in `include`

```yaml
itemIs:
  approved: false
```

### Simple List

When a Filter is a list, the list is assumed to be a list of [Filter Criteria](#criteria) and used in `include`

```yaml
itemIs:
  - approved: false
    filtered: false
  - is_self: true
```

## Filter Types

There are two types of Filter. Both types have the same "shape" in the configuration with the differences between them being:

* what they are testing on
* what criteria are available to test

### Author Filter

Test the Author of an Activity. See [Schema documentation](https://json-schema.app/view/%23%2Fdefinitions%2FAuthorCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json) for all possible Author Criteria

#### Mod Actions/Notes Filter

See [Mod Actions/Notes](../modActions/README.md#mod-action-filter) documentation.

#### Toolbox UserNotes Filter

See [UserNotes](../userNotes/README.md) documentation

### Item Filter

Test for properties of an Activity:

* [Comment Criteria](https://json-schema.app/view/%23%2Fdefinitions%2FCommentState?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)
* [Submission Criteria](https://json-schema.app/view/%23%2Fdefinitions%2FSubmissionState?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

### Subreddit Filter

Test for properties of the Subreddit an Activity belongs to. See [Schema documentation](https://json-schema.app/view/%23%2Fdefinitions%2FSubredditCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

## Named Filters

**Named Filters** work the same as [**Named Rules**](../../README.md#named-rules) and [**Named Actions:**](../../README.md#named-actions)

**Filter Criteria** may be given a `name`. A named **Filter Criteria** can **re-used anywhere in the configuration regardless of location.** This is done by:

* specifying a name on a **Filter Criteria** **once** EX: `name: MyFilterCriteria`
* using the Filter Criteria name in place of a Filter Criteria object

```yaml
runs:
  - name: MyFirstRun
    checks:
      - name: MyFirstCheck
        kind: submission
        itemIs:
          - MyFilterCriteria
        rules:
          #...
        actions:
          #...
      - name: MySecondCheck
        kind: submission
        itemIs:
          include:
            - name: MyFilterCriteria
              criteria:
                approved: false
        rules:
          #...
        actions:
          #...
```

# Examples

## General Usage

Below are examples of where filters can be used

### Usage in a Run

```yaml
runs:
  # this run will only be processed if author is a contributor
  - name: MyRun
    authorIs:
      - isContributor: true
    checks:
     # - ...
```

### Usage in a Check

```yaml
runs:
  - name: MyRun
    checks:
      # check will only be processed if author is a contributor
      - name: MyCheck
        kind: submission
        authorIs:
          - isContributor: true
        rules:
          # ...
        actions:
          # ...
```

### Usage in a Rule

```yaml
runs:
  - name: MyRun
    checks:
      - name: MyCheck
        kind: submission
        rules:
          # rule will only run if author is a contributor
          - name: MyFirstRule
            kind: recentActivity
            authorIs:
              - isContributor: true
            thresholds:
              # ...
        actions:
          # ...
```

### Usage in an Action

```yaml
runs:
  - name: MyRun
    checks:
      - name: MyCheck
        kind: submission
        rules:
          - name: MyFirstRule
            # ...
        actions:
          # action will only run if author is a contributor
          - kind: approve
            authorIs:
              - isContributor: true
```

### Using Author and Item Filter

```yaml
runs:
  - name: MyRun
    checks:
      # Check will only process if author is a contributor AND submission is not approved
      - name: MyCheck
        kind: submission
        authorIs:
          - isContributor: true
        itemIs:
          - approved: false
        rules:
          # ...
        actions:
          # ...
```

## Filter Shapes Usage

Below are examples of how filters can be structured using [filter shapes](#filter-shapes)

### Using a Simple Object

```yaml
runs:
  - name: MyRun
    checks:
      - name: MyCheck
        kind: submission
        # check is only processed if submission is not approved AND not marked as nsfw
        itemIs:
          approved: false
          over_18: false
        rules:
          # ...
        actions:
          # ...
```

### Using a Simple List

```yaml
runs:
  - name: MyRun
    checks:
      - name: MyCheck
        kind: submission
        # check is only processed if submission is EITHER:
        # -> not approved AND not marked as nsfw
        # -> not approved AND marked as nsfw AND has flair text 'Mildly NSFW;
        itemIs:
          # each '-' denotes a NEW set of criteria
          - approved: false
            over_18: false
            
          - link_flair_text: Mildly NSFW
            over_18: true
            approved: false
        rules:
          # ...
        actions:
          # ...
```

### Using a Full Anonymous Filter

```yaml
runs:
  - name: MyRun
    checks:
      - name: MyCheck
        kind: submission
        # check is only processed if submission is EITHER:
        # -> not approved AND not marked as nsfw
        # -> not approved AND marked as nsfw AND has flair text 'Mildly NSFW;
        itemIs:
          include:
            - approved: false
              over_18: false
              
            - link_flair_text: Mildly NSFW
              over_18: true
              approved: false
        rules:
          # ...
        actions:
          # ...
```

### Using a Full Anonymous Filter with Exclude

```yaml
runs:
  - name: MyRun
    checks:
      - name: MyCheck
        kind: submission
        # check is only processed if submission is NOT approved
        itemIs:
          exclude:
            - approved: true
        rules:
          # ...
        actions:
          # ...
```

### Using a Full Named Filter

```yaml
runs:
  - name: MyRun
    checks:
      - name: MyCheck
        kind: submission
        # check is only processed if submission is:
        # -> not approved AND not marked as nsfw
        itemIs:
          include:
            - name: sfwNotApproved
              criteria:
                - approved: false
                  over_18: false
        rules:
        # ...
        actions:
        # ...
```

## Author Filter Examples

### New User

```yaml
# author's account is less than 30 days old AND has less than 30 comment karma
authorIs:
  include:
    - name: newUser
      criteria:
        age: < 30 days
        commentKarma: < 30
```

### New User with pattern in Name

```yaml
# author's account is less than 30 days old AND has less than 30 comment karma AND has 'nsfw' in their account name
authorIs:
  include:
    - name: newUser
      criteria:
        age: < 30 days
        commentKarma: < 30
        name: '/nsfw/i'
```

### User has pattern in their profile description

```yaml
authorIs:
  include:
    - description:
        - '/Add Me On Snapchat/i'
        - '/Add my snapchat/i'
        - '/Dm me for content/i'
        - '/Will Verify/i'
```

### Exclude moderators AND users by name

Useful when CM should not run if the author is from a list of users or a moderator

```yaml
authorIs:
  excludeCondition: AND
  exclude:
    # will not run if user is a mod or is automoderator
    - isMod: true

    # will not run if the user is in the list below
    - name:
        - User1
        - User2
        - User3
```

## Item Filter Examples

### Unmoderated comment by non-op

```yaml
itemIs:
  - removed: false
    approved: false
    op: false
```

### Submission is self post with no flair

```yaml
itemIs:
  - is_self: true
    link_flair_text: false
```
