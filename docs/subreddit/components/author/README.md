# Author

## Rule

The **Author** rule triggers if any [AuthorCriteria](https://json-schema.app/view/%23%2Fdefinitions%2FAuthorCriteria?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) from a list are either **included** or **excluded**, depending on which property you put them in.

**AuthorCriteria** that can be checked:
* name (u/userName)
* author's subreddit flair text
* author's subreddit flair css
* author's subreddit mod status
* [Toolbox User Notes](/docs/subreddit/components/userNotes)

The Author **Rule** is best used in conjunction with other Rules to short-circuit a Check based on who the Author is. It is easier to use a Rule to do this then to write **author filters** for every Rule (and makes Rules more re-useable).

Consult the [schema](https://json-schema.app/view/%23%2Fdefinitions%2FAuthorRuleJSONConfig?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

### Examples

* Basic examples
    * Flair new user Submission [YAML](/docs/subreddit/components/author/flairNewUserSubmission.yaml) | [JSON](/docs/subreddit/components/author/flairNewUserSubmission.json5) - If the Author does not have the `vet` flair then flair the Submission with `New User`
    * Flair vetted user Submission [YAML](/docs/subreddit/components/author/flairNewUserSubmission.yaml) | [JSON](/docs/subreddit/components/author/flairNewUserSubmission.json5) - If the Author does have the `vet` flair then flair the Submission with `Vetted`
* Used with other Rules
    * Ignore vetted user [YAML](/docs/subreddit/components/author/flairNewUserSubmission.yaml) | [JSON](/docs/subreddit/components/author/flairNewUserSubmission.json5) - Short-circuit the Check if the Author has the `vet` flair
    
## Filter

All **Rules** and **Checks** have an optional `authorIs` property that takes an [AuthorOptions](https://json-schema.app/view/%23%2Fdefinitions%2FAuthorOptions?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) object. 

**This property works the same as the Author Rule except that:**
* On **Rules** if all criteria fail the Rule is **skipped.** 
  * If a Rule is skipped **it does not fail or pass** and so does not affect the outcome of the Check.
  * However, if all Rules on a Check are skipped the Check will fail.
* On **Checks** if all criteria fail the Check **fails**.

### Examples

* Skip recent activity check based on author [YAML](/docs/subreddit/components/author/authorFilter.yaml) | [JSON](/docs/subreddit/components/author/authorFilter.json5) - Skip a Recent Activity check for a set of subreddits if the Author of the Submission has any set of flairs.

## Flair users and submissions

Flair users and submissions based on certain keywords from submitter's profile.

Consult [User Flair schema](https://json-schema.app/view/%23%2Fdefinitions%2FUserFlairActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) and [Submission Flair schema](https://json-schema.app/view/%23%2Fdefinitions%2FFlairActionJson?url=https%3A%2F%2Fraw.githubusercontent.com%2FFoxxMD%2Fcontext-mod%2Fmaster%2Fsrc%2FSchema%2FApp.json) for a complete reference of the rule's properties.

### Examples

* OnlyFans submissions [YAML](/docs/subreddit/components/author/onlyfansFlair.yaml) | [JSON](/docs/subreddit/components/author/onlyfansFlair.json5) - Check whether submitter has typical OF keywords in their profile and flair both author + submission accordingly.
