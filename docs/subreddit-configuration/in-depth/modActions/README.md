---
grand_parent: Subreddit Configuration
parent: In Depth
---

# Mod Actions

# Table of Contents

* [Overview](#overview)
* [Mod Note Action](#mod-note-action)
* [Mod Action Filter](#mod-action-filter)
  * [API Usage](#api-usage)
  * [When To Use?](#when-to-use)
  * [Examples](#examples)

# Overview

[Mod Notes](https://www.reddit.com/r/modnews/comments/t8vafc/announcing_mod_notes/) is a feature for New Reddit that allow moderators to add short, categorizable notes to Users of their subreddit, optionally associating te note with a submission/comment the User made. They are inspired by [Toolbox User Notes](https://www.reddit.com/r/toolbox/wiki/docs/usernotes) which are also [supported by ContextMod.](/docs/moderators/components/userNotes) Reddit's **Mod Notes** also combine [Moderation Log](https://mods.reddithelp.com/hc/en-us/articles/360022402312-Moderation-Log) actions (**Mod Actions**) for the selected User alongside moderator notes, enabling a full "overview" of moderator interactions with a User in their subreddit.

ContextMod supports adding **Mod Notes** to an Author using an [Action](/docs/moderators/components/README.md#mod-note) and using **Mod Actions/Mod Notes** as a criteria in an [Author Filter](/docs/moderators/components/README.md#author-filter)

# Mod Note Action

[**Schema Reference**](https://json-schema.app/view/%23%2Fdefinitions%2FModNoteActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json)

* `type` must be one of the [valid note labels](https://www.reddit.com/dev/api#POST_api_mod_notes):
    * BOT_BAN
    * PERMA_BAN
    * BAN
    * ABUSE_WARNING
    * SPAM_WARNING
    * SPAM_WATCH
    * SOLID_CONTRIBUTOR
    * HELPFUL_USER

```yaml
actions:
  - kind: modnote
    type: SPAM_WATCH
    content: 'a note only mods can see message' # optional
    referenceActivity: boolean # if true the Note will be linked to the Activity being processed
```

# Mod Action Filter

ContextMod can use **Mod Actions** (from moderation log) and **Mod Notes** in an [Author Filter](/docs/moderators/components/README.md#author-filter).

## API Usage

Notes/Actions are **not** included in the data Reddit returns for either an Author or an Activity. This means that, in most cases, ContextMod is required to make **one additional API call to Reddit during Activity processing** if Notes/Actions as used as part of an **Author Filter**.

The impact of this additional call is greatest when the Author Filter is used as part of a **Comment Check** or running for **every Activity** such as part of a Run. Take this example:

No Mod Action filtering

* CM makes 1 api call to return new comments, find 10 new comments across 6 users
* Processing each comment, with no other filters, requires 0 additional calls
* At the end of processing 10 comments, CM has used a total of 1 api call.

Mod Action Filtering Used

* CM makes 1 api call to return new comments, find 10 new comments across 6 users
* Processing each comment, with a mod action filter, requires 1 additional api call per user
* At the end of processing 10 comments, CM has used a total of **7 api calls**

### When To Use?

In general,**do not** use Mod Actions in a Filter if:

* The filter is on a [**Comment** Check](/docs/moderators/components/README.md#checks) and your subreddit has a high volume of Comments
* The filter is on a [Run](/docs/moderators/components/README.md#runs) and your subreddit has a high volume of Activities

If you need Mod Notes-like functionality for a high volume subreddit consider using [Toolbox UserNotes](/docs/moderators/components/userNotes) instead.

In general, **do** use Mod Actions in a Filter if:

* The filter is on a [**Submission** Check](/docs/moderators/components/README.md#checks)
* The filter is part of an [Author **Rule**](/docs/moderators/components/README.md#author) that is processed as **late as possible in the rule order for a Check**
* Your subreddit has a low volume of Activities (less than 100 combined submissions/comments in a 10 minute period, for example)
* The filter is on an Action

## Usage and Examples

Filter by Mod Actions/Notes on an Author Filter are done using the `modActions` property:

```yaml
age: '> 1 month'
# ...
modActions:
  - ...
```

There two valid shapes for the Mod Action criteria: [ModLogCriteria](https://json-schema.app/view/%23%2Fdefinitions%2FModLogCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json) and [ModNoteCriteria](https://json-schema.app/view/%23%2Fdefinitions%2FModNoteCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Freddit-context-bot%2Fedge%2Fsrc%2FSchema%2FApp.json).

### ModLogCriteria

Used for filtering by **Moderation Log** actions *and/or general notes*.

* `activityType` -- Optional. If Mod Action is associated with an activity specify it here. A list or one of:
  * `submission`
  * `comment`
* `type` -- Optional. The type of Mod Log Action. A list or one of:
  * `INVITE`
  * `NOTE`
  * `REMOVAL`
  * `SPAM`
  * `APPROVAL`
* `description` -- additional mod log details (string) to filter by -- not documented by reddit. Can be string or regex string-like `/.* test/i`
* `details` -- additional mod log details (string) to filter by -- not documented by reddit. Can be string or regex string-like `/.* test/i`

```yaml
activityType: submission
type:
  - REMOVAL
  - SPAM
search: total
count: '> 3 in 1 week'
```
### ModNoteCriteria

Inherits `activityType` from ModLogCriteria. If either of the below properties in included on the criteria then any other ModLogCriteria-specific properties are **ignored**.

* `note` -- the contents of the note to match against. Can be one of or a list of strings/regex string-like `/.* test/i`
* `noteType` -- If specified by the note, the note type (see [Mod Note Action](#mod-note-action) type). Can be one of or a list of strings/regex string-like `/.* test/i`

```yaml
noteType: SOLID_CONTRIBUTOR
search: total
count: '> 3 in 1 week'
```

### Examples

Author has more than 2 submission approvals in the last month

```yaml
type: APPROVAL
activityType: submission
search: total
count: '> 2 in 1 month'
```

Author has at least 1 BAN note

```yaml
noteType: BAN
search: total
count: '>= 1'
```

Author has at least 3 notes which include the words "self" and "promotion" in the last month

```yaml
note: '/self.*promo/i'
activityType: submission
search: total
count: '>= 3 in 1 month'
```
