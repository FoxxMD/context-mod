# ContextMod Cookbook

Here you will find useful configs for CM that provide real-world functionality. This is where you should look first for **"how do i..."** questions.

## How To Use

Each recipe includes what type of config piece it is (Rule, Check, Action, Run, etc...). Keep this in mind before copy-pasting to make sure it goes in the right place in your config.

### Copy-Pasting

If the type is **Check** or **Run** the recipe contents will have instructions in the comments on how to use it as a **full subreddit config** OR **by itself (default).** If not Check/Run then when copy-pasting you will need to ensure it is placed in the correct spot in your config.


### As Config Fragment

**Checks, Runs, Actions, and Rule** recipes can be referenced in your config without copy-pasting by using them as [Config Fragments.](/docs/subreddit/components/README.md#partial-configurations) These need to be placed in the correct spot in your config, just like copy-pasting, but only require the URL of the recipe instead of all the code.

To use a recipe as a fragment **copy** the URL of the config and insert into your config like this:

```yaml
- 'url:https://URL_TO_CONFIG'
```

EXAMPLE: Using the **Config** link from the [Free Karma](#remove-submissions-from-users-who-have-used-freekarma-subs-to-bypass-karma-checks) check below -- copy the **Config** link and insert it into a full subreddit config like this:

<details>
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

## Submission-based Behavior

### Remove submissions from users who have used 'freekarma' subs to bypass karma checks

* Type: **Check**
* [Config](/docs/subreddit/components/cookbook/freekarma.yaml)

If the user has any activity (comment/submission) in known freekarma subreddits in the past (100 activities) then remove the submission.

### Remove submissions from users who have crossposted the same submission 4 or more times

* Type: **Check**
* [Config](/docs/subreddit/components/cookbook/crosspostSpam.yaml)

If the user has crossposted the same submission in the past (100 activities) 4 or more times in a row then remove the submission.

### Remove link submissions where the user's history is comprised of 10% or more of the same link

* Type: **Check**
* [Config](/docs/subreddit/components/cookbook/selfPromo.yaml)

If the link origin (youtube author, twitter author, etc. or regular domain for non-media links)

* comprises 10% or more of the users **entire** history in the past (100 activities or 6 months)
* or comprises 10% or more of the users **submission** history in the past (100 activities or 6 months) and the user has low engagement (<50% of history is comments or 40%> of comment are as OP)

then remove the submission

## Comment-based behavior

### Remove comment if the user has posted the same comment 4 or more times in a row

* Type: **Check**
* [Config](/docs/subreddit/components/cookbook/commentSpam.yaml)

If the user made the same comment (with some fuzzy matching) 4 or more times in a row in the past (100 activities or 6 months) then remove the comment.

### Remove comment if it is chat invite link spam

* Type: **Check**
* [Config](/docs/subreddit/components/cookbook/discordSpam.yaml)

This rule goes a step further than automod can by being more discretionary about how it handles this type of spam. 

* Remove the comment if:
  * Comment being checked contains **only** a chat link (no other text) OR
  * Chat links appear **anywhere** in three or more of the last 100 comments the Author has made

This way ContextMod can more easily distinguish between these use cases for a user commenting with a chat link:

* actual spammers who only spam a chat link
* users who may comment with a link but have context for it either in the current comment or in their history
* users who many comment with a link but it's a one-off event (no other links historically)
