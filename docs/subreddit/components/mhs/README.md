# Table of Contents

* [Overview](#overview)
  * [MHS Predictions](#mhs-predictions)
    * [Flagged](#flagged)
    * [Confidence](#confidence)
* [Usage](#usage)
    * [Minimal/Default Config](#minimaldefault-config)
    * [Full Config](#full-config)
      * [Historical Matching](#historical-matching)
* [Examples](#examples)

# Overview

[moderatehatespeech.com](https://moderatehatespeech.com/) (MHS) is a [non-profit initiative](https://moderatehatespeech.com/about/) to identify and fight toxic and hateful content online using programmatic technology such as machine learning models.

They offer a [toxic content prediction model](https://moderatehatespeech.com/framework/)   specifically trained on and for [reddit content](https://www.reddit.com/r/redditdev/comments/xdscbo/updated_bot_backed_by_moderationoriented_ml_for/) as well as partnering [directly with subreddits.](https://moderatehatespeech.com/research/subreddit-program/).

Context Mod leverages their [API](https://moderatehatespeech.com/docs/) for toxic content predictions in the **MHS Rule.**

The **MHS Rule** sends an Activity's content (title or body) to MHS which returns a prediction on whether the content is toxic and actionable by a moderator.

## MHS Predictions

MHS's toxic content predictions return two indicators about the content it analyzed. Both are available as test conditions in ContextMod.

### Flagged

MHS returns a straight "Toxic or Normal" **flag** based on how it classifies the content.

Example

* `Normal` - "I love those pineapples"
* `Toxic` - "why are we having all these people from shithole countries coming here"

### Confidence

MHS returns how **confident** it is of the flag classification on a scale of 0 to 100.

Example

"why are we having all these people from shithole countries coming here"

* Flag = `Toxic`
* Confidence = `97.12` -> The model is 97% confident the content is `Toxic`

# Usage

**An MHS Api Key is required to use this Rule**. An API Key can be acquired, for free, by creating an account at [moderatehatespeech.com](https://moderatehatespeech.com).

The Key can be provided by the bot's Operator in the [bot config credentials](https://json-schema.app/view/%23/%23%2Fdefinitions%2FBotInstanceJsonConfig/%23%2Fdefinitions%2FBotCredentialsJsonConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fedge%2Fsrc%2FSchema%2FOperatorConfig.json) or in the subreddit's config in the top-level `credentials` property like this:

```yaml
credentials:
  mhs:
    apiKey: 'myMHSApiKey'

# the rest of your config below
polling:
  # ...
runs:
  # ...
```

### Minimal/Default Config

ContextMod provides a reasonable default configuration for the MHS Rule if you do not wish to configure it yourself. The default configuration will trigger the rule if the MHS prediction:

* flags as `toxic`
* with `90% or greater` confidence

Example

```yaml
rules:
  - kind: mhs
    
  # rest of your rules here...
```

### Full Config


|   Property   |  Type   |                                        Description                                        | Default |
|--------------|---------|-------------------------------------------------------------------------------------------|---------|
| `flagged`    | boolean | Test whether content is flagged as toxic (true) or normal (false)                         | `true`  |
| `confidence` | string  | Comparison against a number 0 to 100 representing  how confident MHS is in the prediction | `>= 90` |
| `testOn`     | array   | Which parts of the Activity to send to MHS. Options: `title` and/or `body`                | `body`  |

Example

```yaml
rules:
  - kind: mhs
    criteria:
      flagged: true # triggers if MHs flags the content as toxic AND
      confidence: '> 66' # MHS is 66% or more confident in its prediction
      testOn:  # send the body of the activity to the MHS prediction service
        - body
```

#### Historical Matching

Like the [Sentiment](/docs/subreddit/components/sentiment#historical) and [Regex](/docs/subreddit/components/regex#historical) rules CM can also use MHS predictions to check content from the Author's history.

Example

```yaml
rules:
  - kind: mhs
    # ...same config as above but can include below...
    historical:
      mustMatchCurrent: true # if true then CM will not check author's history unless current Activity matches MHS prediction criteria
      totalMatching: '> 1' # comparison for how many activities in history must match to trigger the rule
      window: 10 # specify the range of activities to check in author's history
      criteria: #... if specified, overrides parent-level criteria
```

# [Template Variables](/docs/subreddit/actionTemplating.md)


|      Name       |                                  Description                                  | Example                                                                                                                                                |
|-----------------|-------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| `result`        | Summary of rule results (also found in Actioned Events)                       | Current Activity MHS Test: ✓ Confidence test (>= 90) PASSED MHS confidence of 99.85%   Flagged pass condition of true (toxic) MATCHED MHS flag 'toxic' |
| `window`        | Number or duration of Activities considered from window                       | 1 activities                                                                                                                                           |
| `criteriaTest`  | MHS value to test against                                                     | MHS confidence is > 95%                                                                                                                                |
| `totalMatching` | Total number of activities (current + historical) that matched `criteriaTest` | 1                                                                                                                                                      |

# Examples

Report if MHS flags as toxic

```yaml
rules:
  - kind: mhs
actions:
  - kind: report
    content: 'MHS flagged => {{rules.mhs.summary}}'
```

Report if MHS flags as toxic with 95% confidence

```yaml
rules:
  - kind: mhs
    confidence: '>= 95'
actions:
  - kind: report
    content: 'MHS flagged => {{rules.mhs.summary}}'
```

Report if MHS flags as toxic and at least 3 recent activities in last 10 from author's history are also toxic

```yaml
rules:
  - kind: mhs
    historical:
      window: 10
      mustMatchCurrent: true
      totalMatching: '>= 3'
actions:
  - kind: report
    content: 'MHS flagged => {{rules.mhs.summary}}'
```

Approve if MHS flags as NOT toxic with 95% confidence

```yaml
rules:
  - kind: mhs
    confidence: '>= 95'
    flagged: false
actions:
  - kind: approve
```
