Provided here are **complete, ready-to-go configuration** that can copy-pasted straight into your configuration wiki page to get going with ContextMod immediately.

These configurations attempt to provide sensible, non-destructive, default behavior for some common scenarios and subreddit types.

In most cases these will perform decently out-of-the-box but they are not perfect. You should still monitor bot behavior to see how it performs and will most likely still need to tweak these configurations to get your desired behavior.

All actions for these configurations are non-destructive in that:

* All instances where an activity would be modified (remove/ban/approve) will have `dryRun: true` set to prevent the action from actually being performed
* These instances will also have a `report` action detailing the action would have been performed

**You will have to remove the `report` action and `dryRun` settings yourself.** This is to ensure that you understand the behavior the bot will be performing. If you are unsure of this you should leave them in place until you are certain the behavior the bot is performing is acceptable.

**YAML** is the same format as **automoderator**

## Submission-based Behavior

### Remove submissions from users who have used 'freekarma' subs to bypass karma checks

[YAML](/docs/subreddit/components/subredditReady/freekarma.yaml) | [JSON](/docs/subreddit/components/subredditReady/freekarma.json5)

If the user has any activity (comment/submission) in known freekarma subreddits in the past (50 activities or 6 months) then remove the submission.

### Remove submissions from users who have crossposted the same submission 4 or more times

[YAML](/docs/subreddit/components/subredditReady/crosspostSpam.yaml) | [JSON](/docs/subreddit/components/subredditReady/crosspostSpam.yaml)

If the user has crossposted the same submission in the past (50 activities or 6 months) 4 or more times in a row then remove the submission.

### Remove submissions from users who have crossposted or used 'freekarma' subs

[YAML](/docs/subreddit/componentsc/subredditReady/freeKarmaOrCrosspostSpam.yaml) | [JSON](/docs/subreddit/components/subredditReady/freeKarmaOrCrosspostSpam.json5)

Will remove submission if either of the above two behaviors is detected

### Remove link submissions where the user's history is comprised of 10% or more of the same link

[YAML](/docs/subreddit/components/subredditReady/selfPromo.yaml) | [JSON](/docs/subreddit/components/subredditReady/selfPromo.json5)

If the link origin (youtube author, twitter author, etc. or regular domain for non-media links)

* comprises 10% or more of the users **entire** history in the past (100 activities or 6 months)
* or comprises 10% or more of the users **submission** history in the past (100 activities or 6 months) and the user has low engagement (<50% of history is comments or 40%> of comment are as OP)

then remove the submission

## Comment-based behavior

### Remove comment if the user has posted the same comment 4 or more times in a row

[YAML](/docs/subreddit/components/subredditReady/commentSpam.yaml) | [JSON](/docs/subreddit/components/subredditReady/commentSpam.json5)

If the user made the same comment (with some fuzzy matching) 4 or more times in a row in the past (50 activities or 6 months) then remove the comment.

### Remove comment if it is discord invite link spam

[YAML](/docs/subreddit/components/subredditReady/discordSpam.yaml) | [JSON](/docs/subreddit/components/subredditReady/discordSpam.json5)

This rule goes a step further than automod can by being more discretionary about how it handles this type of spam. 

* Remove the comment and **ban a user** if:
  * Comment being checked contains **only** a discord link (no other text) AND
  * Discord links appear **anywhere** in three or more of the last 10 comments the Author has made

otherwise...

* Remove the comment if:
  * Comment being checked contains **only** a discord link (no other text) OR
    * Comment contains a discord link **anywhere** AND
    * Discord links appear **anywhere** in three or more of the last 10 comments the Author has made

Using these checks ContextMod can more easily distinguish between these use cases for a user commenting with a discord link:

* actual spammers who only spam a discord link
* users who may comment with a link but have context for it either in the current comment or in their history
* users who many comment with a link but it's a one-off event (no other links historically)

Additionally, you could modify both/either of these checks to not remove one-off discord link comments but still remove if the user has a historical trend for spamming links
