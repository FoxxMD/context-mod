---
parent: Subreddit Configuration
---

# Cookbook

Here you will find useful configs for CM that provide real-world functionality. This is where you should look first for **"how do i..."** questions.

## How To Use

Each recipe includes what type of config piece it is (Rule, Check, Action, Run, etc...). Keep this in mind before copy-pasting to make sure it goes in the right place in your config.

### Copy-Pasting

If the type is **Check** or **Run** the recipe contents will have instructions in the comments on how to use it as a **full subreddit config** OR **by itself (default).** If not Check/Run then when copy-pasting you will need to ensure it is placed in the correct spot in your config.


### As Config Fragment

**Checks, Runs, Actions, and Rule** recipes can be referenced in your config without copy-pasting by using them as [Config Fragments.](/docs/moderators/components/README.md#partial-configurations) These need to be placed in the correct spot in your config, just like copy-pasting, but only require the URL of the recipe instead of all the code.

To use a recipe as a fragment **copy** the URL of the config and insert into your config like this:

```yaml
- 'url:https://URL_TO_CONFIG'
```

EXAMPLE: Using the **Config** link from the [Free Karma](#remove-submissions-from-users-who-have-used-freekarma-subs-to-bypass-karma-checks) check below -- copy the **Config** link and insert it into a full subreddit config like this:

<details markdown="block">
<summary>Config</summary>

```yaml
polling:
  - newSub
runs:
  - name: MyFirstRun
    checks:
       # freekarma check
      - 'url:https://github.com/FoxxMD/context-mod/blob/master/docs/subreddit/components/cookbook/freekarma.yaml'
      - name: MyRegularCheck
        kind: submission
        # ...
```
</details>

# Recipes

## Spam Prevention

### Remove submissions from users who have used 'freekarma' subs to bypass karma checks

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/freekarma.yaml)

If the user has any activity (comment/submission) in known freekarma subreddits in the past (100 activities) then remove the submission.

### Remove submissions that are consecutively spammed by the author

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/crosspostSpam.yaml)

If the user has crossposted the same submission in the past (100 activities) 4 or more times in a row then remove the submission.

### Remove submissions if users is flooding new

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/floodingNewSubmissions.yaml)

If the user has made more than 4 submissions in your subreddit in the last 24 hours than new submissions are removed and user is tagged with a modnote.

### Remove submissions posted in diametrically-opposed subreddit

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/diametricSpam.yaml)

If the user makes the same submission to another subreddit(s) that are "thematically" opposed to your subreddit it is probably spam. This check removes it. Detects all types of submissions (including images).

### Remove comments that are consecutively spammed by the author

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/commentSpam.yaml)

If the user made the same comment (with some fuzzy matching) 4 or more times in a row in the past (100 activities or 6 months) then remove the comment.

### Remove comment if it is a chat invite link spam

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/chatSpam.yaml)

This rule goes a step further than automod can by being more discretionary about how it handles this type of spam.

* Remove the comment if:
  * Comment being checked contains **only** a chat link (no other text) OR
  * Chat links appear **anywhere** in three or more of the last 100 comments the Author has made

This way ContextMod can more easily distinguish between these use cases for a user commenting with a chat link:

* actual spammers who only spam a chat link
* users who may comment with a link but have context for it either in the current comment or in their history
* users who many comment with a link but it's a one-off event (no other links historically)

## Repost Detection

### Remove comments reposted from youtube video submissions

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/youtubeCommentRepost.yaml)

**Requires bot has an API Key for Youtube.**

Removes comment on reddit if the same comment is found on the youtube video the submission is for.

### Remove comments reposted from reddit submissions

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/commentRepost.yaml)

Checks top-level comments on submissions younger than 30 minutes:
* Finds other reddit submissions based on crosspost/duplicates/title/URL, takes top 10 submissions based # of upvotes
  * If this comment matches any top comments from those other submissions with at least 85% sameness then it is considered a repost and removed

### Remove reposted reddit submission

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/submissionRepost.yaml)

Checks reddit for top posts with a **Title** that is 90% or more similar to the submission being checked and removes it, if found.

## Self Promotion

### Remove link submissions where the user's history is comprised of 10% or more of the same link

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/selfPromo.yaml)

If the link origin (youtube author, twitter author, etc. or regular domain for non-media links)

* comprises 10% or more of the users **entire** history in the past (100 activities or 6 months)
* or comprises 10% or more of the users **submission** history in the past (100 activities or 6 months) and the user has low engagement (<50% of history is comments or 40%> of comment are as OP)

then remove the submission

### Remove submissions posted in 'newtube' subreddits

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/newtube.yaml)

If the user makes the same submission to a 'newtube' or self-promotional subreddit it is removed and a modnote is added.

## Safety

### Remove comments on brigaded submissions when user has no history

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/brigadingNoHistory.yaml)

The users of comments on a brigaded submission (based on a special submission flair) have their comment history checked -- if they have no participation in your subreddit then the comment is removed.

### Remove submissions from users with a history of sex solicitation 

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/sexSolicitationHistory.yaml)

If the author of a submission has submissions in their history that match common reddit "sex solicitation" tags (MFA, R4F, M4F, etc...) the submission is removed and a modnote added.

This is particularly useful for subreddits with underage audiences or mentally/emotionally vulnerable groups. 

The check can be modified to removed comments by changing `kind: submission` to `kind: comment`

## Verification

### Verify users from r/TranscribersOfReddit

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/transcribersOfReddit.yaml)

[r/TranscribersOfReddit](https://www.reddit.com/r/transcribersofreddit) is a community of volunteers transcribing images and videos, across reddit, into plain text.

This Check detects their standard transcription template and also checks they have a history in r/transcribersofreddit -- then approves the comment and flairs the user with **Transcriber ✍️**

### Require submission authors have prior subreddit participation

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/requireNonOPParticipation.yaml)

Submission is removed if the author has **less than 5 non-OP comments** in your subreddit prior to making the submission.

### Require submission authors make a top-level comment with 15 minutes of posting

* Type: **Check**
* [Config](/docs/moderators/components/cookbook/requireNonOPParticipation.yaml)

After making a submission the author must make a top-level comment with a regex-checkable pattern within X minutes. If the comment is not made the submission is removed.

# Monitoring

### Sticky a comment on popular submissions

* Type: **Run**
* [Config](/docs/moderators/components/cookbook/popularSubmissionMonitoring.yaml)

This **Run** should come after any other Runs you have that may remove a Submission.

The Run will cause CM to check new submissions for 3 hours at a 10 minute interval. The bot will then make a comment and sticky it WHEN it detects the number of upvotes is abnormal for how long the Submission has been "alive".
