**Note:** This is for **bot operators.** If you are a subreddit moderator check out the **[Getting Started Guide](/docs/gettingStartedMod.md)**

Before you can start using your bot on reddit there are a few steps you must take:

* Create your bot account IE the reddit account that will be the "bot"
* Create a Reddit application
* Authenticate your bot account with the application

At the end of this process you will have this info:

* clientId
* clientSecret
* refreshToken
* accessToken

**Note:** If you already have this information you can skip this guide **but make sure your redirect uri is correct if you plan on using the web interface.**

# Table Of Contents

* [Creating an Application](#create-application)
* [Authenticate Your Bot](#authenticate-your-bot-account)
  * [Using CM OAuth Helper](#cm-oauth-helper-recommended)
  * [Using Aardvark OAuth Helper](#aardvark-oauth-helper)
* [Provide Credentials to CM](#provide-credentials-to-cm)

# Create Application

Visit [your reddit preferences](https://www.reddit.com/prefs/apps) and at the bottom of the page go through the **create an(other) app** process.
* Give it a **name**
* Choose **web app**
* If you know what you will use for **redirect uri** go ahead and use it, otherwise use **http://localhost:8085** for now

Click **create app**.

Then write down your **Client ID, Client Secret, and redirect uri** somewhere (or keep this webpage open)

# Authenticate Your Bot Account

There are **two ways** you can authenticate your bot account. It is recommended to use the CM oauth helper.

## CM OAuth Helper (Recommended)

This method will use CM's built in oauth flow. It is recommended because it will ensure your bot is authenticated with the correct oauth permissions.

### Start CM with Client ID/Secret

Start the application while providing the **Client ID** and **Client Secret** you received. Refer to the [operator config guide](/docs/operatorConfiguration.md) if you need help with this.

Examples:

* CLI - `node src/index.js --clientId=myId --clientSecret=mySecret`
* Docker - `docker run -e "CLIENT_ID=myId" -e "CLIENT_SECRET=mySecret" foxxmd/context-mod`

Then open the CM web interface (default is [http://localhost:8085](http://localhost:8085))

Follow the directions in the helper to finish authenticating your bot and get your credentials (Access Token and Refresh Token)

## Aardvark OAuth Helper

This method should only be used if you cannot use the [CM OAuth Helper method](#cm-oauth-helper-recommended) because you cannot access the CM web interface.

* Visit [https://not-an-aardvark.github.io/reddit-oauth-helper/](https://not-an-aardvark.github.io/reddit-oauth-helper/) and follow the instructions given.  
  * **Note:** You will need to update your **redirect uri.**
* Input your **Client ID** and **Client Secret** in the text boxes with those names.
* Choose scopes. **It is very important you check everything on this list or CM may not work correctly**
    * edit
    * flair
    * history
    * identity
    * modcontributors
    * modflair
    * modposts
    * modself
    * mysubreddits
    * read
    * report
    * submit
    * wikiread
    * wikiedit (if you are using Toolbox User Notes)
* Click **Generate tokens**, you will get a popup asking you to approve access (or login) -- **the account you approve access with is the account that Bot will control.**
* After approving an **Access Token** and **Refresh Token** will be shown at the bottom of the page. Save these to use with CM.

# Provide Credentials to CM

At the end of the last step you chose you should now have this information saved somewhere:

* clientId
* clientSecret
* refreshToken
* accessToken

This is all the information you need to run your bot with CM.

Using these credentials follow the [operator config guide](/docs/operatorConfiguration.md) to finish setting up your CM instance.
