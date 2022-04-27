High level overviews, important features of, and example usage for significant components in a subreddit's configuration are found here.

This list is not exhaustive. [For complete documentation on a subreddit's configuration consult the schema.](https://json-schema.app/view/%23?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)

# Table of Contents

* [Runs](#runs)
  * [Flow Control Defaults](#flow-control-defaults-using-runs)
  * [Filter Defaults](#filter-defaults-using-runs)
* [Checks](#checks)
  * [Testing Rules](#testing-rules)
  * [Specifying Flow Control](#specifying-flow-control)
  * [Recording Options](#recording-options)
* [Rules](#rules)
  * [Named Rules](#named-rules)
  * [List of Rules](#list-of-rules)
    * [Attribution](#attribution)
    * [Recent Activity](#recent-activity)
    * [Repeat Activity](#repeat-activity)
    * [History](#history)
    * [Author](#author)
    * [Regex](#regex)
    * [Repost](#repost)
* [Rule Sets](#rule-sets)
* [Actions](#actions)
  * [Named Actions](#named-actions)
  * [Templating](#templating)
  * [List of Actions](#list-of-actions)
    * [Approve](#approve)
    * [Ban](#ban)
    * [Comment](#comment)
    * [Contributor (Add/Remove)](#contributor)
    * [Dispatch/Delay](#dispatch)
      * [Cancel Dispatch](#cancel-dispatch)
    * [Flair](#flair)
      * [User Flair](#user-flair)
      * [Submission Flair](#submission-flair)
    * [Lock](#lock)
    * [Message](#message)
    * [Remove](#remove)
    * [Report](#report)
    * [UserNote](#usernote)
* [Filters](#filters)
  * [Filter Types](#filter-types)
    * [Author Filter](#author-filter)
    * [Item Filter](#item-filter)
  * [Named Filters](#named-filters)
* [Common Patterns](#common-patterns)
  * [Conditions](#conditions)
  * [Activities `window`](#activities-window)
  * [URL Tokens](#url-tokens)
  * [Thresholds and Comparisons](#thresholds-and-comparisons)
  * [Durations](#durations)
  * [Filter Defaults](#filter-defaults)
  * [Flow Control Defaults](#flow-control-defaults)
* [Subreddit-Level Configuration](#subreddit-level-configuration)
  * [Polling (Where CM Gets Activities From)](#polling)
    * [Polling Sources](#polling-sources) 
    * [Configuring Polling Sources](#configuring-polling-sources)
* [Best Practices](#best-practices)
  * [Check Ordering](/docs/components/advancedConcepts)
* [Subreddit-ready examples](/docs/components/subredditReady)

# Runs

A **Run** is made up of a set of [**Checks**](#checks) that represent a group of related behaviors the bot should check for or perform. Checks within a Run are processed in the order they are listed. Refer to the [How It Works](/docs/README.md#how-it-works) section to see how Runs fit into CM's lifecycle.

**Runs** are the largest unit of behavior in a subreddit's configuration and are defined at the top level of the configuration like so:

```yaml
runs:
    # the first run of the config
  - name: MyFirstRun
    checks:
      ...
  - name: MySecondRun
    checks:
      ...
```

An example of Runs:

* A group of Checks that look for missing flairs on a user or a new submission and flair accordingly
* A group of Checks that detect spam or self-promotion and then remove those activities

Both group of Checks are independent of each other (don't have any patterns or actions in common).

However, Checks processed *prior* to a Run can determine if a Run is processed or not depending on the [flow control](#specifying-flow-control) configured in those Checks.

## Flow Control Defaults Using Runs

[Checks](#specifying-flow-control) in a Run that do not specify their own [Flow Control](#specifying-flow-control) can have their defaults configured at the Run level:

```yaml
runs:
  - name: MyFirstRun
    postFail: nextRun
    postTrigger: next
    checks:
      ...
```

Runs may also have these flow control defaults specified at the [subreddit or bot level](#flow-control-defaults).

## Filter Defaults Using Runs

Checks in a Run may have their [Filters](#filters) merged or replaced by run-level [filter defaults](#filter-defaults):

```yaml
runs:
  - name: MyFirstRun
    filterCriteriaDefaults:
      authorIs:
        - isMod: false
```

Runs may also have these filter behavior defaults specified at the [subreddit or bot level](#filter-defaults).

# Checks

A **Check** is a set of:

* Zero or more [**Rules**](#rules) that define what conditions should **trigger** this Check.
* Zero or more [**Actions**](#actions) that define what the bot should do once the Check is **triggered**.

Refer to the [How It Works](/docs/README.md#how-it-works) section to see how Checks fit into CM's lifecycle.

* If a Check has no Rules and passes any [Filters](#filters) it is automatically triggered
* If a Check is triggered and has no Actions it is only [recorded](#recording-options)
* **Checks must have explicitly defined:**
  * **name**
  * **kind** -- what type of [Activity](/docs/README.md#activity) (`submission` or `comment`) it should process

```yaml
runs:
  - name: MyFirstRun
    checks:
        # a minimal check
      - name: MyMinimalCheck
        kind: submission
  
        # a normal check
      - name: MyNormalCheck
        kind: submission
        rules:
          ...
        actions:
          ...

        # a kitchen-sink check
      - name: KitchenSink
        kind: submission
        description: A friendly description
        itemIs:
          - approved: false
        authorIs:
          - verified: true
        rules:
          ...
        actions:
          ...
        postTrigger: stop
        postFail: next
```

## Testing Rules

The [**Rules**](#rules) specified in a Check are processed in the order they were written in.

A Check determines when it has been **triggered** by setting a [`condition`](#conditions) to evaluate Rules and [Rule Sets](#rule-sets) with. When this condition is:

* `AND` -- **all** Rules in the Check must be **triggered** for the Check to be **triggered**
* `OR` -- **any** Rule in the Check that is **triggered** will **trigger** the Check

```yaml
- name: MyCheck
  kind: submission
  condition: AND # Rule1 AND Rule2 must be triggered to trigger MyCheck
  rules:
    - name: Rule1
      ...
    - name: Rule2
      ...
```

```yaml
- name: MyCheck
  kind: submission
  condition: OR # Rule1 OR Rule2 must both be triggered to trigger MyCheck
  rules:
    - name: Rule1
      ...
    - name: Rule2
      ...
```

## Specifying Flow Control

When a Check is finished processing it can have one of two states: **triggered** or not **triggered**. The behavior of CM after a Check is finished processing 1) depends on what state the Check is in and 2) is _dictated_ by the Check itself using a property for each type of state:

* `postFail` -- for not triggered
* `postTrigger` -- for triggered

This enables a user to arbitrarily configure how CM responds to the triggering (or not triggering) of a Check.

Each Check will **always** have these properties defined -- either explicitly or passed down as defaults from a [Run](#flow-control-defaults-using-runs), [Subreddit](#filter-defaults), or Operator configuration.

Refer to the main [**Flow Control** documentation](/docs/components/advancedConcepts/flowControl.md) for an in-depth explanation and all possible options.

## Recording Options

`postFail` and `postTrigger` also enable specifying if/how an [Event](/docs/README.md#event) is recorded. Valid options for recording:

* `false` -- do not record this Event
* `true` -- record Event to all available outputs
* `database` -- record Event to the database
* `influx` -- record Event to InfluxDB (not implemented)
* `list of: database, influx` -- a list of outputs to record to

The default recording options for flow control properties are:

* `postFail` -- `false` (do not record)
* `postTrigger` -- `true` (record to all)

Recording options can be explicitly defined by providing a [PostBehaviorOptionConfig](https://json-schema.app/view/%23/%23%2Fdefinitions%2FRunJson/%23%2Fdefinitions%2FPostBehaviorOptionConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json) object to one/both of the flow control properties EX:

```yaml
- name: MyCheck
  kind: submission
  postTrigger:
    recordTo: database
  postFail:
    recordTo: false
```

When an Activity has finished being processed CM will aggregate all Recording Options and output to all specified. Any "positive" outputs override a `false` output IE to prevent an Event from being recorded **all** `recordTo` values must be `false`.

`recordTo` values can also be specified in flow control defaults for a [Run](#flow-control-defaults-using-runs), [Subreddit](#filter-defaults), or Operator configuration.

# Rules

A **Rule** is some set of **criteria** (conditions) that are tested against an [Activity](/docs/README.md#activity), a User, or a User's history. A Rule is considered **triggered** when the **criteria** for that rule are found to be **true** for whatever is being tested against.

Rules must have a `kind` that identifies what kind of Rule they are.

Optionally, they may have [Filters](#filters).

## Named Rules

Rules may be given a `name`. If a Rule is named it can **re-used anywhere in the configuration regardless of location.** This is done by:

* specifying a name on a Rule **once** EX: `name: MyNamedRule`
* using the Rule's name in place of a Rule object in your Checks or Rule Sets.

```yaml
runs:
  - name: MyFirstRun
    checks:
      - name: MyFirstCheck
        kind: submission
        rules:
          - name: AnonymousRule1
            kind: regex
            ...

            # use the name of the Rule instead of writing an entire Rule object
          - NamedRule1

          - name: AnonymousRule2
            kind: recent
            ...
        actions:
          ...
      - name: MySecondCheck
        kind: submission
        rules:
          # named rule
          - name: NamedRule1
            kind: history
            ...
```

Named Rules are essential building blocks of a readable and effective configuration. If you find yourself repeating the same Rule many times it's a sign you should give it a name and replace it's usage with references to it.

See **Rule Name Reuse Examples [YAML](/docs/components/advancedConcepts/ruleNameReuse.yaml) | [JSON](/docs/components/advancedConcepts/ruleNameReuse.json5)**

## List of Rules

### Attribution

[**Full Documentation**](/docs/components/attribution)

The **Attribution** rule will aggregate an Author's content Attributions (youtube channels, twitter, website domains, etc.) and can check on their totals or percentages of all Activities over a time period:

* Total # of attributions
* As percentage of all Activity or only Submissions
* Look at all domains or only media (youtube, vimeo, etc.)
* Include self posts (by reddit domain) or not

### Recent Activity

[**Full Documentation**](/docs/components/recentActivity)

Given a list subreddit criteria, the **Recent Activity** rule finds Activities matching those criteria in the Author's history over [window](#activities-window) and then allows for comparing different facets of the results:

* number of activities found
* aggregated karma from activities
* number of distinct subreddits found

The above can also be expressed as a percentage of all activities found, instead of number.

The search can also be modified in a number of ways:

* Filter found activities using an [Item Filter](#item-filter)
* Only return activities that match the Activity from the Event being processed
  * Using [image detection](/docs/imageComparison.md) (pixel or perceptual hash matching)
* Only return certain types of activities (only submission or only comments)

### Repeat Activity

[**Full Documentation**](/docs/components/repeatActivity)

The **Repeat Activity** rule will check for patterns of repetition in an Author's Activity history over a [window](#activities-window). When comparing submissions it checks a composite of the submissions' title and content.

To determine sameness it uses an average of [Dice's Coefficient](https://en.wikipedia.org/wiki/S%C3%B8rensen%E2%80%93Dice_coefficient), [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity), and [Levenshtein Distance](https://en.wikipedia.org/wiki/Levenshtein_distance) weighted by the length of the content being compared (more weight for longer content).

Some of the ways the rule can be modified:

* Only return repeated activities that match the Activity from the Event being processed
* Specify the sameness percentage used to classify a repeat (default must be 85% similar)
* Include/exclude activities from a list of subreddit criteria
* Specify gap size allowed between non-repeats

### History

[**Full Documentation**](/docs/components/history)

The **History** rule can check an Author's submission/comment statistics over a time period:

* Submission total or percentage of All Activity
* Comment total or percentage of all Activity
* Comments made as OP (commented in their own Submission) total or percentage of all Comments

### Author

[**Full Documentation**](/docs/components/author)

The **Author** rule behaves the same as the [Author Filter](#author-filter). It can be used when you want to test Author state alongside other rules to create more complex behavior than would be possible by only applying to individual Rules or an entire check.

### Regex

[**Full Documentation**](/docs/components/regex)

The **Regex** rule matches on text content from an Activity in the same way automod uses regex. However, it can also be used to match on content from the Author's Activity history over a [window](#activities-window).

### Repost

[**Full Documentation**](/docs/components/repost)

The **Repost** rule is used to find reposts for both **Submissions** and **Comments**, depending on what type of **Check** it is used on.

This rule is for searching **all of Reddit** for reposts, as opposed to just the history of the Author of the Activity being checked. If you only want to check for reposts by the Author of the Activity being checked you should use the [Repeat Activity](/docs/components/repeatActivity) rule.

# Rule Sets

The `rules` list on a `Check` can contain both `Rule` objects and `RuleSet` objects.

A **Rule Set** is a "nested" set of `Rule` objects with a `condition` specified. These allow you to create more complex trigger behavior by combining multiple rules that a Check only sees as "one" Rule to use with its [condition.](#testing-rules)

```yaml
runs:
  - name: MyFirstRun
    checks:
      - name: ComplexCheck
        kind: submission
        # all "top level" rules must be triggered
        # --  TopLevelRule1 AND TopLevelRule2 and the Rule Set
        condition: AND
        rules:
          - name: TopLevelRule1
            kind: regex
            ...

          - name: TopLevelRule2
            kind: history
            ...

            # a Rule Set
          - condition: OR # if any Rule in this Rule Set is triggered the Check sees the Rule Set as "triggered"
            rules:
              - name: NestedRule1
                kind: recent
                ...
              - name: NestedRule2
                kind: recent
                ...
```

See **ruleSets [YAML](/docs/components/advancedConcepts/ruleSets.yaml) | [JSON](/docs/components/advancedConcepts/ruleSets.json5)** for a complete example as well as consulting the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FRuleSetJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json).

# Actions

An **Action** is some action the bot can take against the checked Activity (comment/submission) or Author of the Activity as well as some "meta" actions used for controlling how CM handles Events.

CM has Actions for most things a normal reddit user or moderator can do.

Actions are performed in the order they are listed in the **Check.**

## Named Actions

**Named Actions** work the same as [**Named Rules**](#named-rules) and [**Named Filters:**](#named-filters)

Actions may be given a `name`. If an Action is named it can **re-used anywhere in the configuration regardless of location.** This is done by:

* specifying a name on an Action **once** EX: `name: MyNamedAction`
* using the Action's name in place of a Action object in your Checks

```yaml
runs:
  - name: MyFirstRun
    checks:
      - name: MyFirstCheck
        kind: submission
        rules:
          ...
        actions:
          - kind: remove 
          - MyNamedAction # use the name of the Action instead of writing an entire Action object
      - name: MySecondCheck
        kind: submission
        rules:
          ...
        actions:
          - name: MyNamedAction
            kind: comment
            content: 'This is a test comment the bot will make'
```

## Templating

Actions that can submit text (Report, Comment, UserNote) will have their `content` values run through a [Mustache Template](https://mustache.github.io/). This means you can insert data generated by Rules into your text before the Action is performed.

[**Action Templating Documentation**](/docs/actionTemplating.md)

## List of Actions

### Approve

Approve an Activity. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FApproveActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)

Optionally, may specify a list of targets to approve:

* `self` -- approve Activity being processed
* `parent` -- if Activity being processed is a Comment then approve the Submission it comes from

```yaml
actions:
  - kind: approve
    target: ['self'] # or both with ['self', 'parent']
```

### Ban

Ban the Author of the Activity being processed. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FBanActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)

`message` can be [templated](#templating) and use [URL Tokens](#url-tokens)

```yaml
actions:
  - kind: ban
    message: string # required, the ban message the user receives
    note: string # mod note
    reason: string # reason shown for ban
    # number of days to ban user. Min 1 Max 999
    # 
    # leaving 'duration' unspecified will ban user permanently
    duration: number 
```

### Comment

Reply to the Activity being processed with a comment. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FCommentActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fmaster%2Fsrc%2FSchema%2FApp.json)

* If the Activity is a Submission the comment is a top-level reply
* If the Activity is a Comment the comment is a child reply

```yaml
actions:
  - kind: comment
    content: string # required, the content of the comment
    distinguish: boolean # distinguish as a mod
    sticky: boolean # sticky comment
    lock: boolean # lock the comment after creation

```

### Contributor

Add or Remove the Author of the Activity being processed as an Approved Contributor to the subreddit. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FContributorActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

```yaml
actions:
  - kind: comment
    action: 'add or remove' # required, add or remove contributor
  
```

### Dispatch

Create a new Event, from the currently processing Activity or its Parent, for CM to process. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FDispatchActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

Optionally, may specify a list of targets to dispatch:

* `self` -- create new Event from Activity being processed
* `parent` -- if Activity being processed is a Comment then create a new Event from the Submission it comes from

Additionally, may specify a [duration](#durations) of time to **delay** processing by.

```yaml
actions:
  - kind: dispatch
    target: ['self']
    delay: '10 minutes'
    identifier: 'myDispatch'
```

TODO in-depth documentation on dispatch

#### Cancel Dispatch

Cancel a [**Dispatch Action**](#dispatch) that has been delayed using:

* the target of the action (`self` or `parent`) AND/OR
* an identifier used for the initial Dispatch Action

```yaml
actions:
  - kind: cancelDispatch
    target: ['self']
    identifier: 'myDispatch'
```

### Flair

#### User Flair

Set the flair for the Author of the Activity being processed. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FUserFlairActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

```yaml
actions:
  - kind: userflair
    flair_template_id: string # optional, flair template to use. Will override all other properties
    css: string # optional, css value to use
    text: string # optional, css class name to use
```

If the `userflair` action is used but **no properties are specified** then the action **removes any user flair.**

#### Submission Flair

Set the flair for the Submission being processed [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FFlairActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

```yaml
actions:
  - kind: flair
    flair_template_id: string # optional, flair template to use. Will override all other properties
    css: string # optional, css value to use
    text: string # optional, css class name to use
```

If the `flair` action is used but **no properties are specified** then the action **removes any submission flair.**

### Lock

Lock the Activity being processed. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FLockActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

```yaml
actions:
  - kind: lock
```

### Message

Send a private message. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FMessageActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

Must specify these properties:

* `asSubreddit: boolean` -- send the message as the subreddit or not
* `content: string` -- the content of the message to send

Some other things to note:

* If the `to` property is not specified then the message is sent to the Author of the Activity being processed
  * `to` may be a **User** (u/aUser) or a **Subreddit** (r/aSubreddit)
  * `to` **cannot** be a Subreddit when `asSubreddit: true` -- IE cannot send subreddit-to-subreddit messages
* `content` can be [templated](#templating) and use [URL Tokens](#url-tokens)

```yaml
actions:
  - kind: message
    asSubreddit: true
    content: 'A message sent as the subreddit'
    title: 'Title of the message'
    to: 'u/aUser' # do not specify 'to' in order default to sending to Author of Activity being processed
```

### Remove

Remove the Activity being processed. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FRemoveActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

```yaml
actions:
  - kind: remove
    spam: boolean # optional, mark as spam on removal
```

#### What About Removal Reason?

Reddit does not support setting a removal reason through the API. Please complain in [r/modsupport](https://www.reddit.com/r/modsupport) or [r/redditdev](https://www.reddit.com/r/redditdev) to help get this added :)

### Report

Report the Activity being processed. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FReportActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

`content` is required. It can be [templated](#templating) and use [URL Tokens](#url-tokens)

```yaml
actions:
  - kind: report
    content: 'This is what will show up in the report'
```

### UserNote

Add a Toolbox User Note to the Author of the Activity. [Schema Documentation](https://json-schema.app/view/%23/%23%2Fdefinitions%2FSubmissionCheckJson/%23%2Fdefinitions%2FUserNoteActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

Your subreddit must have [Toolbox UserNotes](/docs/components/userNotes) enabled for this action to work.

* `type` is required
* `content` can be [templated](#templating) and use [URL Tokens](#url-tokens)

```yaml
actions:
  - kind: usernote
    type: spamwarn
    content: 'Usernote message'
    allowDuplicate: boolean # if false then the usernote will not be added if the same note appears for this activity
```

# Filters

**Filters** are an additional channel for determining if an Event should be processed by ContextMod. They differ from **Rules** in several key ways:

* **Runs, Checks, Rules, and Actions** can **all** have Filters
* Filters test against the **current state** of the Activity (or it's Author) being processed, rather than looking at history/context/etc...
* Filter test results only determine if the Run, Check, Rule, or Action **should run** -- rather than triggering it
  * When the filter test **passes** the thing being tested continues to process as usual
  * When the filter test **fails** the thing being tested **fails**.

A Filter has these properties:

* `include` -- An optional list of Filter Criteria. If **any** passes the filter passes.
* `exclude` -- An optional list of Filter Criteria. All **must NOT** pass for the filter to pass. Ignored if `include` is present.
* `excludeCondition` -- A [condition](#conditions) that determines how the list of Filter Criteria are tested together

## Filter Criteria

A **criteria** is some property of a thing can be tested, and what the expected outcome is EX

`age: '> 2 months'` => Author is older than 2 months

**Filter Criteria** is one of more **criteria** combined together to form a set of criteria that must all be true together for the Filter Criteria to be true EX

```yaml
age: '> 2 months'
verified: true
```

The above Filter Criteria is true if the Author's account is older than 2 months AND they have a verified email

### Filter Shapes

Generically, a "full" Filter looks like this:

```yaml
include: #optional
  - name: AFilterCriteria
    criteria:
      ...
  ... #one or more filter criteria

exclude: #optional
  ... # one or more filter criteria

excludeCondition: OR or AND
```

But for convenience a Filter's shape can be simplified with a few assumptions

#### Simple Object

When a Filter is an object, the object is assumed to be a Filter Criteria which is used in `include`

```yaml
itemIs:
  approved: false
```

#### Simple List

When a Filter is a list, the list is assumed to be a list of Filter Criteria and used in `include`

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

### Item Filter

Test for properties of an Activity:

* [Comment Criteria](https://json-schema.app/view/%23%2Fdefinitions%2FCommentState?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)
* [Submission Criteria](https://json-schema.app/view/%23%2Fdefinitions%2FSubmissionState?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

## Named Filters

**Named Filters** work the same as [**Named Rules**](#named-rules) and [**Named Actions:**](#named-actions)

**Filter Criteria** may be given a `name`. A named **Filter Criteria** can **re-used anywhere in the configuration regardless of location.** This is done by:

* specifying a name on a **Filter Criteria** **once** EX: `name: MyFitlerCriteria`
* using the Filter Criteria's name in place of a Filter Criteria object

```yaml
runs:
  - name: MyFirstRun
    checks:
      - name: MyFirstCheck
        kind: submission
        itemIs:
          - MyFilterCriteria
        rules:
          ...
        actions:
          ...
      - name: MySecondCheck
        kind: submission
        itemIs:
          include:
            - name: MyFilterCriteria
              criteria:
                approved: false
        rules:
          ...
        actions:
          ...
```

# Common Patterns

## Conditions

ContextMod uses **AND/OR** operands in many places to allow you to determine how a set of conditions is evaluated.

A condition is a **statement** that can be determined to be true or false. A set of conditions:

* an orange is orange
* the sky is blue
* the sun is black

These conditions can be combined together to evaluate to either true or false using AND or OR operands.

#### AND

**All** statements in the set must be **true** for the condition to be **true**

* an orange is orange => TRUE
* the sky is blue => TRUE
* the sun is black => FALSE

=> Condition evaluates to FALSE

#### OR

**Any** statement in the set must be **true** for the condition to be **true**

* an orange is orange => TRUE
* the sky is blue => TRUE
* the sun is black => FALSE

=> Condition evaluates to TRUE because the first two were true

## Activities `window`

Most **Rules** have a `window` property somewhere within their configuration. This property defines the range of **Activities** (submission and/or comments) that should be retrieved for checking the criteria of the Rule.

[Full Activities `window` documentation](/docs/activitiesWindow.md)

## URL Tokens

A field that can use URL Tokens can use a special prefix at the beginning of the string to tell ContextMod to fetch content from a URL instead of using the field as-is for content. If the field is also [templated](#templating) then the content is run through templating after being retrieved.

If value starts with `wiki:` then the proceeding value will be used to get a wiki page from the current subreddit EX 

`wiki:botconfig/mybot` tries to get `https://reddit.com/r/currentSubreddit/wiki/botconfig/mybot`

If the value starts with `wiki:` and ends with `|someValue` then `someValue` will be used as the base subreddit for the wiki page EX

EX `wiki:replytemplates/test|ContextModBot` tries to get `https://reddit.com/r/ContextModBot/wiki/replytemplates/test`

If the value starts with `url:` then the value is fetched as an external url and expects raw text returned EX

EX `url:https://pastebin.com/raw/38qfL7mL` tries to get the text response of `https://pastebin.com/raw/38qfL7mL`

If none of the above is used the value is used as-is.

## Thresholds and Comparisons

Most rules/filters have criteria that require you to define a specific condition to test against. This can be anything from repeats of activities to account age.

In all of these scenarios the condition is defined using a subset of [comparison operators](https://www.codecademy.com/articles/fwd-js-comparison-logical) (very similar to how automoderator does things).

Available operators:

* `<` -- **less than** => `5 < 6` => 5 is less than 6
* `>` -- **greater than** => `6 > 5` => 6 is greater than 5
* `<=` -- **less than or equal to** => `5 <= 5` => 5 is less than **or equal to** 5
* `>=` -- **greater than or equal to** => `5 >= 5` => 5 is greater than **or equal to** 5

In the context of a rule/filter comparison you provide the comparison **omitting** the value that is being tested. An example...

The RepeatActivity rule has a `threshold` comparison to test against the number of repeat activities it finds

* You want the rule to trigger if it finds **4 or more repeat activities**
* The rule would be configured like this `"threshold": ">= 4"`

Essentially what this is telling the rule is `threshold: "x >= 4"` where `x` is the largest repeat of activities it finds.

### Percentages

Some criteria accept an optional **percentage** to compare against:

```
"threshold": "> 20%"
```

Refer to the individual rule/criteria schema to see what this percentage is comparing against.

## Durations

Some criteria accept an optional **duration** to compare against:

```
"threshold": "< 1 month"
```

The duration value compares a time range from **now** to `duration value` time in the past.

Refer to [duration values in activity window documentation](/docs/activitiesWindow.md#duration-values) as well as the individual rule/criteria schema to see what this duration is comparing against.

## Filter Defaults

[Filters](#filters) can have default values specified at the [bot level](https://json-schema.app/view/%23/%23%2Fdefinitions%2FBotInstanceJsonConfig/%23%2Fdefinitions%2FFilterCriteriaDefaults?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fedge%2Fsrc%2FSchema%2FOperatorConfig.json), [subreddit level](https://json-schema.app/view/%23/%23%2Fdefinitions%2FFilterCriteriaDefaults?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json), and [run level](https://json-schema.app/view/%23/%23%2Fdefinitions%2FRunJson/%23%2Fdefinitions%2FFilterCriteriaDefaults?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json).

Each level is "more specific" than the previous and will override more specific levels below it until, eventually, the defaults are applied to a Check.

IE `Bot Defaults -> Subreddit Defaults (overiddes Bot) -> Run Defaults (overrides Subreddit) -> Apply to Check`

### Applying Default Behavior

The defaults object also specifies how it applies itself to the Filters on a Check using `authorIsBehavior` and `itemIsBehavior`.

Both behavior properties have these options:

* `merge` -- will **add** any Filter Criteria in the defaults to the Filters, leaving any explicitly specified in the Check untouched.
* `replace` -- If the Check has any explicitly specified Filters the default's Filter Criteria are **ignored**.

### Filter Defaults Defaults

If no Filter Defaults are specified at any level then all Checks will have this default applied:

```yaml
authorIs:
  exclude:
    - isMod: true
authorIsBehavior: merge
```

In other words -- Checks will not run if the Author of the Activity being processed is a Moderator.

## Flow Control Defaults

See [Flow Control Documentation](/docs/components/advancedConcepts/flowControl.md#default-behaviors)

# Subreddit-Level Configuration

Other than configuration specific to processing Events there are many subreddit-level defaults and settings that can be controlled from the top-level of your configuration.

See [Filter Defaults](#filter-defaults) and [Flow Control Defaults](#flow-control-defaults) for links to those defaults for a subreddit.

## Polling

**Polling** is how ContextMod creates [Events](/docs/README.md#event) from new Activities in a Subreddit. CM monitors one or more polling sources and processes any new Activities it discovers.

### Polling Sources

There are four valid polling sources:

#### `unmoderated`

Activities that have yet to be approved/removed by a mod. This includes all modqueue (reports/spam) and new submissions.

Use this if you want the bot to act like a regular moderator and act on anything that can be seen from mod tools.

This is the **default polling source.**

#### `modqueue`

Activities requiring moderator review, such as reported things and items caught by the spam filter.

Use this if you only want the Bot to process reported/filtered Activities.

#### `newSub`

Get only Submissions that show up in /r/mySubreddit/new

Use this if you want the bot to process Submissions only when:

* they are not initially filtered by Automoderator or
* after they have been manually approved from modqueue

#### `newComm`

Get only new Comments

Use this if you want the bot to process Comments only when:

* they are not initially filtered by Automoderator or
* after they have been manually approved from modqueue

### Configuring Polling Sources

Polling can be configured by specifying the top level `polling` property in your subreddit's configuration:

```yaml
polling:
  ...

runs:
  ...
```

`polling` must be a list comprised of either **polling source names**:

```yaml
polling:
  - unmoderated
  - modqueue
```

and/or a [**polling source objects**](https://json-schema.app/view/%23/%23%2Fdefinitions%2FPollingOptions?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json):

```yaml
# using names and objects
polling:
  # using a name
  - unmoderated
  
  # using an object
  - pollOn: newComm
    delayUntil: 30
```

# Best Practices

## Order of Operations

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
  
This behavior can be arbitrarily controlled using [Flow Control](#specifying-flow-control) but, in order to keep complexity low, the above approach is a good rule-of-thumb.

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

### Configuration Re-use and Caching

ContextMod implements caching functionality for:

* author history ([`window` criteria](#activities-window) in rules)
* `authorIs` and `itemIs` results
* `content` that uses wiki pages (on Comment/Report/Ban Actions)
* User Notes
* Rule results

All of these use api requests so caching them reduces api usage.

Cached results can be re-used if the criteria in configuration is identical to a previously cached result or by using **Named Rules/Actions/Filters**. So...

* author history cache results are re-used if **`window` criteria on a Rule is identical to the `window` on another Rule** IE always use **7 Days** or always use **50 Items** for absolute counts.
* `authorIs` criteria is identical to another `authorIs` elsewhere in configuration..
* etc...

Re-use will result in less API calls and faster Check times.

PROTIP: You can monitor the re-use of cache in the `Cache` section of your subreddit on the web interface. See the tooltips in that section for a better breakdown of cache statistics.

[Learn more about how Caching works](/docs/operator/caching.md)

# Subreddit-Ready Examples

Refer to the [Subreddit-Ready Examples](/docs/components/subredditReady) section to find ready-to-use configurations for common scenarios (spam, freekarma blocking, etc...). This is also a good place to familiarize yourself with what complete configurations look like.
